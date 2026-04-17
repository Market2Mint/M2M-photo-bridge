import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, CheckCircle2, Loader2, Plus, Trash2, ExternalLink, Camera, User, Mail, Phone, ArrowRight, ArrowLeft, Package, Barcode, Edit3 } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { signInAnonymously } from 'firebase/auth';
import Webcam from 'react-webcam';
import { storage, auth } from './firebase';
import { generateSessionId, splitName } from './utils';
import { PhotoData, SessionData } from './types';

const FloatingInput = ({ label, value, onChange, type = "text", icon: Icon, required = false }: any) => {
  const [isFocused, setIsFocused] = useState(false);
  const hasValue = value && value.length > 0;
  
  return (
    <div className="relative group w-full">
      <div className={`
        absolute left-10 top-1/2 -translate-y-1/2 transition-all duration-300 pointer-events-none z-10
        ${(isFocused || hasValue) ? '-translate-y-8 text-[10px] text-[#66FFB2] opacity-100' : 'text-gray-500 text-[13px] opacity-60'}
        uppercase font-black tracking-widest whitespace-nowrap
      `}>
        {label}
      </div>
      <div className="relative">
        {Icon && (
          <Icon className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors duration-300 z-10 ${isFocused || hasValue ? 'text-[#66FFB2]' : 'text-gray-600'}`} />
        )}
        <input
          required={required}
          type={type}
          value={value}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onChange={onChange}
          className={`
            w-full bg-[#0A0A0A] border-2 transition-all duration-300 py-5 ${Icon ? 'pl-11' : 'pl-4'} pr-4
            ${isFocused || hasValue ? 'border-white bg-[#111]' : 'border-gray-500'}
            text-white font-bold focus:outline-none rounded-2xl text-[15px]
          `}
        />
      </div>
    </div>
  );
};

export default function App() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [mode, setMode] = useState<'intake' | 'capture' | 'success'>('intake');
  const [successOrderId, setSuccessOrderId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Intake form state
  const [intakeData, setIntakeData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });

  const webcamRef = useRef<Webcam>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    
    if (params.get('status') === 'success') {
      setSuccessOrderId(params.get('orderId'));
      setMode('success');
      return;
    }

    const name = params.get('name') || '';
    const email = params.get('email') || '';
    const phoneNumber = params.get('phoneNumber') || '';

    // Sync intake form with URL params
    const { fName, lName } = splitName(name);
    setIntakeData({
      firstName: fName,
      lastName: lName,
      email: email,
      phone: phoneNumber,
    });
    
    const sessionData: SessionData = {
      sessionid: (params.get('sessionid') || generateSessionId()).toUpperCase().trim(),
      name,
      email,
      phoneNumber,
      totalAmount: params.get('totalAmount') || '',
      reportid1: params.get('reportid1') || '',
      storecode: (params.get('storecode') || 'DEFAULT').toLowerCase().trim(),
      date: params.get('date') || new Date().toISOString().split('T')[0],
      servicesOrdered: params.get('servicesOrdered') || '',
      totalamountBridge: params.get('totalamountBridge') || '',
      customernotes: params.get('customernotes') || '',
    };
    setSession(sessionData);

    if (!name || !email || !phoneNumber) {
      setMode('intake');
    } else {
      setMode('capture');
    }

    signInAnonymously(auth).catch(() => {});
  }, []);

  const handleCapture = useCallback((type: 'item' | 'label') => {
    const itemPhotos = photos.filter(p => p.type === 'item');
    const labelPhotos = photos.filter(p => p.type === 'label');

    if (type === 'item' && itemPhotos.length >= 4) {
      setError('Maximum 4 item photos allowed.');
      return;
    }
    if (type === 'label' && labelPhotos.length >= 1) {
      setError('Only 1 label photo allowed. Remove existing to retake.');
      return;
    }

    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      setFlash(true);
      setTimeout(() => setFlash(false), 150);

      const photoId = Math.random().toString(36).substring(7);
      const newPhoto: PhotoData = {
        id: photoId,
        url: imageSrc,
        status: 'syncing',
        timestamp: Date.now(),
        type,
      };

      setPhotos((prev) => [...prev, newPhoto]);
      processAndUpload(imageSrc, photoId, type);
    }
  }, [webcamRef, photos, session]);

  const processAndUpload = async (base64Str: string, photoId: string, type: 'item' | 'label') => {
    if (!session) return;

    // 10 Second Timeout Guard
    const timeoutId = setTimeout(() => {
      setPhotos(prev => prev.map(p => 
        (p.id === photoId && p.status === 'syncing') ? { ...p, status: 'error' } : p
      ));
    }, 10000);

    try {
      const res = await fetch(base64Str);
      const blob = await res.blob();
      const file = new File([blob], `${type}-${photoId}.jpg`, { type: 'image/jpeg' });

      const options = {
        maxSizeMB: 0.2, // Slightly larger for better detail
        maxWidthOrHeight: 1600, // Higher res for inspection
        useWebWorker: true,
        fileType: 'image/jpeg' as string,
        initialQuality: 0.7,
      };
      
      const compressedFile = await imageCompression(file, options);
      
      // Dynamic Path Construction: kiosk_uploads/{storecode}/{sessionid}/
      const storagePath = `kiosk_uploads/${session.storecode}/${session.sessionid}/${type}_${Date.now()}.jpg`;
      const storageRef = ref(storage, storagePath);
      
      await uploadBytes(storageRef, compressedFile);
      const downloadURL = await getDownloadURL(storageRef);

      clearTimeout(timeoutId);
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId ? { ...p, url: downloadURL, status: 'ready' } : p
        )
      );
    } catch (err) {
      console.error('Upload error:', err);
      clearTimeout(timeoutId);
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId ? { ...p, status: 'error' } : p
        )
      );
    }
  };

  const retryPhoto = (photo: PhotoData) => {
    setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, status: 'syncing' } : p));
    processAndUpload(photo.url, photo.id, photo.type);
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const handleIntakeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (session) {
      setSession({
        ...session,
        name: `${intakeData.firstName} ${intakeData.lastName}`,
        email: intakeData.email,
        phoneNumber: intakeData.phone,
      });
      setMode('capture');
    }
  };

  const isEmailValid = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const isPhoneValid = (phone: string) => phone.replace(/\D/g, '').length >= 10;

  const formatPhoneNumber = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 6) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 6)}-${numbers.slice(6, 10)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setIntakeData({ ...intakeData, phone: formatted });
  };
  const isIntakeValid = intakeData.firstName.trim() !== '' && 
                        intakeData.lastName.trim() !== '' && 
                        isEmailValid(intakeData.email) && 
                        isPhoneValid(intakeData.phone);

  const handleHandoff = () => {
    if (!session) return;
    const { fName, lName } = splitName(session.name);
    
    const jotformUrl = new URL('https://pci.jotform.com/form/261047358857164');
    jotformUrl.searchParams.set('sessionid', session.sessionid);
    jotformUrl.searchParams.set('name[first]', fName);
    jotformUrl.searchParams.set('name[last]', lName);
    jotformUrl.searchParams.set('email', session.email);
    jotformUrl.searchParams.set('phoneNumber', session.phoneNumber);
    jotformUrl.searchParams.set('totalAmount', session.totalAmount);
    jotformUrl.searchParams.set('storecode', session.storecode);
    jotformUrl.searchParams.set('servicesOrdered', session.servicesOrdered);

    window.location.href = jotformUrl.toString();
  };

  const allPhotosReady = photos.length > 0 && 
                         photos.every(p => p.status === 'ready') && 
                         !!photos.find(p => p.type === 'label');
  const itemPhotos = photos.filter(p => p.type === 'item');
  const labelPhoto = photos.find(p => p.type === 'label');

  const obfuscateEmail = (email: string) => {
    if (!email) return 'N/A';
    const [name, domain] = email.split('@');
    if (!domain) return email;
    return `${name[0]}***@${domain}`;
  };

  if (mode === 'success') {
    return (
      <div className="min-h-screen bg-black text-white font-sans flex items-center justify-center p-0 overflow-hidden relative">
        {/* Security Watermark Overlay */}
        <div className="fixed inset-0 z-0 opacity-[0.02] pointer-events-none flex flex-wrap gap-12 rotate-[-25deg] scale-150">
          {Array.from({ length: 120 }).map((_, i) => (
            <span key={i} className="text-[10px] font-black whitespace-nowrap uppercase tracking-[0.4em]">
              OFFICIAL M2M SECURE SESSION
            </span>
          ))}
        </div>

        <div className="relative z-10 w-full h-screen flex flex-col items-center justify-center px-6">
          {/* Live Security Clock - Premium Positioning */}
          <div className="absolute top-[5vh] left-1/2 -translate-x-1/2 bg-[#0A0A0A] border border-[#66FFB2]/30 px-6 py-2 rounded-full backdrop-blur-md">
            <p className="text-[10px] font-black text-[#66FFB2] tracking-[0.2em] uppercase whitespace-nowrap">
              {currentTime.toLocaleDateString()} | {currentTime.toLocaleTimeString()}
            </p>
          </div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full bg-[#080808] border border-[#1A1A1A] rounded-[32px] p-8 text-center shadow-2xl relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#66FFB2]/50 to-transparent" />
            
            <motion.div 
              animate={{ 
                scale: [1, 1.1, 1],
                opacity: [0.6, 1, 0.6]
              }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              className="w-20 h-20 bg-[#66FFB2]/5 rounded-full flex items-center justify-center mx-auto mb-6"
            >
              <CheckCircle2 className="w-12 h-12 text-[#66FFB2]" />
            </motion.div>
            
            <h1 className="text-2xl font-black tracking-tight mb-2 uppercase text-[#66FFB2] whitespace-nowrap">Order Finalized</h1>
            <p className="text-gray-500 text-[9px] mb-8 uppercase tracking-[0.2em] font-black opacity-60">Follow these final steps before leaving:</p>
            
            <div className="space-y-3 mb-8 text-left">
              {[
                { icon: User, text: "Show this screen to the Shop Attendant." },
                { icon: Edit3, text: "Write the DIGITS ONLY clearly on your label." },
                { icon: Shield, text: "Ensure your box is fully secured and taped." }
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-4 bg-black/40 p-4 rounded-2xl border border-[#111]">
                  <div className="w-8 h-8 bg-[#66FFB2]/10 rounded-lg flex items-center justify-center shrink-0">
                    <step.icon className="w-4 h-4 text-[#66FFB2]" />
                  </div>
                  <p className="text-[12px] font-bold text-gray-300 leading-tight">{step.text}</p>
                </div>
              ))}
            </div>

            <div className="bg-black rounded-2xl p-6 border border-[#222] mb-4">
              <p className="text-[14px] font-black text-white uppercase tracking-tight mb-1">{session?.name || 'VERIFIED CUSTOMER'}</p>
              <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-4">{obfuscateEmail(session?.email || '')}</p>
              <div className="h-px bg-[#111] w-full mb-4" />
              <p className="text-[9px] text-gray-600 uppercase tracking-[0.4em] mb-2 font-black">Order ID Reference</p>
              <motion.p 
                animate={{ textShadow: ["0 0 5px rgba(102,255,178,0)", "0 0 15px rgba(102,255,178,0.4)", "0 0 5px rgba(102,255,178,0)"] }}
                transition={{ duration: 3, repeat: Infinity }}
                className="text-[40px] font-black text-[#66FFB2] leading-none tracking-tighter"
              >
                M2M-{successOrderId || 'XXXXXX'}
              </motion.p>
            </div>
          </motion.div>

          <div className="fixed bottom-0 left-0 right-0 p-6 bg-black">
            <button 
              onClick={() => window.location.href = '/'}
              className="w-full py-5 bg-[#66FFB2] text-black rounded-2xl font-black uppercase tracking-[0.2em] text-sm shadow-[0_0_30px_rgba(102,255,178,0.2)] active:scale-95 transition-transform"
            >
              Finish
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'intake') {
    return (
      <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_#111_0%,_#000_100%)] pointer-events-none opacity-50" />
        
        <div className="relative z-10 w-full px-8 pt-[8vh] flex flex-col h-full">
          <header className="mb-[5vh] text-center">
            <h1 className="text-[18px] font-black tracking-[0.2em] text-[#66FFB2] uppercase mb-1">Customer Intake</h1>
            <p className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-bold opacity-70">Verify details to begin.</p>
          </header>

          <form onSubmit={handleIntakeSubmit} className="space-y-[1vh]">
            <FloatingInput 
              label="First Name" 
              value={intakeData.firstName} 
              onChange={(e: any) => setIntakeData({...intakeData, firstName: e.target.value})}
              icon={User}
              required
            />
            <FloatingInput 
              label="Last Name" 
              value={intakeData.lastName} 
              onChange={(e: any) => setIntakeData({...intakeData, lastName: e.target.value})}
              icon={User}
              required
            />

            <FloatingInput 
              label="Email Address" 
              type="email"
              value={intakeData.email} 
              onChange={(e: any) => setIntakeData({...intakeData, email: e.target.value})}
              icon={Mail}
              required
            />

            <FloatingInput 
              label="Phone Number" 
              type="tel"
              value={intakeData.phone} 
              onChange={handlePhoneChange}
              icon={Phone}
              required
            />

            <div className="pt-[3vh]">
              <button 
                type="submit"
                disabled={!isIntakeValid}
                className={`w-full py-5 rounded-2xl font-black uppercase tracking-[0.2em] text-sm flex items-center justify-center gap-3 transition-all duration-500 overflow-hidden relative ${
                  isIntakeValid 
                    ? 'bg-[#66FFB2] text-black shadow-[0_0_40px_rgba(102,255,178,0.25)] scale-100 hover:scale-[1.02]' 
                    : 'bg-[#111] text-gray-800 opacity-40 cursor-not-allowed border border-[#222]'
                }`}
              >
                {isIntakeValid && (
                  <motion.div 
                    className="absolute inset-0 bg-white/20"
                    animate={{ x: ['-100%', '100%'] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  />
                )}
                <span className="relative z-10 whitespace-nowrap">{isIntakeValid ? 'Start Capture' : 'Complete Form'}</span>
                <ArrowRight className="w-4 h-4 relative z-10" />
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-black text-white font-sans flex flex-col overflow-hidden relative">
      <AnimatePresence>
        {flash && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-white pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* Sleek Fixed Header */}
      <header className="h-[60px] bg-black border-b border-[#1A1A1A] flex items-center px-4 shrink-0 relative z-50">
        <button 
          onClick={() => setMode('intake')}
          className="p-2 -ml-2 text-white hover:text-[#66FFB2] transition-colors active:scale-90"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center">
          <h1 className="text-[14px] font-black tracking-[0.3em] text-[#66FFB2] uppercase whitespace-nowrap">M2M PHOTO BRIDGE</h1>
        </div>
        <div className="w-10" /> {/* Spacer */}
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Taller Viewfinder */}
        <div className="relative h-[55vh] w-full bg-[#080808] border-b border-[#1A1A1A] overflow-hidden shrink-0 z-30">
          <Webcam
            audio={false}
            muted
            playsInline
            ref={webcamRef}
            screenshotFormat="image/webp"
            videoConstraints={{
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            }}
            className="w-full h-full object-cover"
          />
          
          {/* Action Overlay / Control Shelf */}
          <div className="absolute inset-x-0 bottom-0 bg-black/95 pt-8 pb-4 flex flex-col items-center gap-4 px-6 border-t border-white/5 shadow-[0_-20px_40px_rgba(0,0,0,0.8)]">
            <div className="flex justify-center gap-4 w-full">
              <button 
                onClick={() => handleCapture('item')}
                disabled={itemPhotos.length >= 4}
                className="flex-1 h-14 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-20 shadow-2xl"
              >
                <Package className="w-5 h-5 text-[#66FFB2]" />
                <div className="flex flex-col items-start leading-none">
                  <span className="text-[10px] font-black text-white uppercase tracking-widest whitespace-nowrap">Add Item</span>
                  <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter">(Up to 4 as needed)</span>
                </div>
              </button>
              
              <button 
                onClick={() => handleCapture('label')}
                disabled={!!labelPhoto}
                className="flex-1 h-14 bg-[#66FFB2]/10 backdrop-blur-md border border-[#66FFB2]/30 rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-20 shadow-2xl"
              >
                <Barcode className="w-5 h-5 text-[#66FFB2]" />
                <span className="text-[10px] font-black text-white uppercase tracking-widest whitespace-nowrap">Add Label</span>
              </button>
            </div>
            
            <p className="text-[8px] font-bold text-gray-600 uppercase tracking-widest text-center opacity-80">
              Only capture items required for this specific order.
            </p>
          </div>

          <div className="absolute top-4 left-4">
             <div className="bg-black/60 backdrop-blur-md border border-white/5 px-3 py-1.5 rounded-full flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[8px] font-black text-white uppercase tracking-[0.2em] whitespace-nowrap">Live Stream</span>
             </div>
          </div>
        </div>

        {/* Data Pill & Grid */}
        <div className="flex-1 flex flex-col px-6 pt-4 overflow-hidden">
          {/* Elegant Data Pill - Tiered & Edge-Justified */}
          <div className="flex flex-col gap-2 mb-4">
            <div className="flex justify-between items-center w-full">
              <div className="bg-[#0A0A0A] border-2 border-gray-500 shadow-[0_0_10px_rgba(102,255,178,0.2)] rounded-full px-4 py-1 flex items-center">
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest whitespace-nowrap">
                  STORE <span className="text-white ml-1">{session?.storecode}</span>
                </span>
              </div>
              <div className="bg-[#0A0A0A] border-2 border-gray-500 shadow-[0_0_10px_rgba(102,255,178,0.2)] rounded-full px-4 py-1 flex items-center">
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest whitespace-nowrap">
                  ID <span className="text-white ml-1">{session?.sessionid}</span>
                </span>
              </div>
            </div>
            <div className="self-center bg-[#0A0A0A] border-2 border-gray-500 rounded-full px-6 py-1 flex items-center">
              <span className="text-[9px] font-black text-[#66FFB2] uppercase tracking-widest whitespace-nowrap">
                {session?.name || 'GUEST USER'}
              </span>
            </div>
          </div>

          {/* Grid Preview */}
          <div className="grid grid-cols-5 gap-2 mb-8 overflow-y-auto">
            <AnimatePresence mode="popLayout">
              {[0, 1, 2, 3].map((idx) => {
                const photo = itemPhotos[idx];
                return (
                  <motion.div
                    key={`item-${idx}`}
                    layout
                    className={`relative aspect-square rounded-2xl overflow-hidden border-2 ${photo ? 'border-[#66FFB2]/50' : 'border-gray-500 border-dashed'} bg-[#050505] flex items-center justify-center`}
                  >
                    {photo ? (
                      <>
                        <img src={photo.url} alt="Item" className="w-full h-full object-cover" />
                        <button onClick={() => removePhoto(photo.id)} className="absolute top-1 right-1 p-1 bg-black/80 rounded-full z-10 border border-white/10">
                          <Trash2 className="w-2.5 h-2.5 text-red-500" />
                        </button>
                        {photo.status === 'syncing' && (
                          <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                            <Loader2 className="w-4 h-4 text-[#66FFB2] animate-spin" />
                          </div>
                        )}
                        {photo.status === 'error' && (
                          <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center gap-2">
                             <p className="text-[6px] font-black text-red-500 uppercase tracking-widest">Timeout</p>
                             <button 
                               onClick={() => retryPhoto(photo)}
                               className="bg-[#66FFB2] text-black px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest active:scale-90 transition-transform"
                             >
                               Retry
                             </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <Package className="w-4 h-4 text-[#66FFB2]" />
                    )}
                  </motion.div>
                );
              })}

              <motion.div
                layout
                className={`relative aspect-square rounded-2xl overflow-hidden border-2 ${labelPhoto ? 'border-[#66FFB2]' : 'border-gray-500 border-dotted'} bg-[#050505] flex items-center justify-center`}
              >
                {labelPhoto ? (
                  <>
                    <img src={labelPhoto.url} alt="Label" className="w-full h-full object-cover" />
                    <button onClick={() => removePhoto(labelPhoto.id)} className="absolute top-1 right-1 p-1 bg-black/80 rounded-full z-10 border border-white/10">
                      <Trash2 className="w-2.5 h-2.5 text-red-500" />
                    </button>
                    {labelPhoto.status === 'syncing' && (
                      <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 text-[#66FFB2] animate-spin" />
                      </div>
                    )}
                    {labelPhoto.status === 'error' && (
                      <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center gap-2">
                         <p className="text-[6px] font-black text-red-500 uppercase tracking-widest">Timeout</p>
                         <button 
                           onClick={() => retryPhoto(labelPhoto)}
                           className="bg-[#66FFB2] text-black px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest active:scale-90 transition-transform"
                         >
                           Retry
                         </button>
                      </div>
                    )}
                  </>
                ) : (
                  <Barcode className="w-5 h-5 text-[#66FFB2]" />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Sticky Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black via-black/90 to-transparent z-50">
        <button
          onClick={handleHandoff}
          disabled={!allPhotosReady}
          className={`
            w-full py-5 rounded-2xl text-[13px] font-black uppercase tracking-[0.3em] transition-all relative overflow-hidden
            ${allPhotosReady 
              ? 'bg-[#66FFB2] text-white shadow-[0_0_40px_rgba(102,255,178,0.3)] active:scale-[0.98]' 
              : 'bg-[#0A0A0A] text-[#222] border border-[#1A1A1A] cursor-not-allowed'}
          `}
        >
          <span className="relative z-10 whitespace-nowrap">
            {!allPhotosReady && photos.length > 0 ? 'Syncing...' : 'Complete & Proceed'}
          </span>
          {allPhotosReady && (
            <motion.div 
              className="absolute inset-0 bg-white/30"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
          )}
        </button>
      </div>

      {error && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 bg-red-600/90 backdrop-blur-md rounded-full border border-red-500 shadow-2xl"
        >
          <p className="text-[10px] font-black text-white uppercase tracking-widest whitespace-nowrap">{error}</p>
        </motion.div>
      )}
    </div>
  );
}
