import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, CheckCircle2, Loader2, Plus, Trash2, ExternalLink, Camera, User, Mail, Phone, ArrowRight, Package, Barcode, Edit3 } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { signInAnonymously } from 'firebase/auth';
import Webcam from 'react-webcam';
import { storage, auth } from './firebase';
import { generateSessionId, splitName } from './utils';
import { PhotoData, SessionData } from './types';

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

      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId ? { ...p, url: downloadURL, status: 'ready' } : p
        )
      );
    } catch (err) {
      console.error('Upload error:', err);
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId ? { ...p, status: 'error' } : p
        )
      );
    }
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
      <div className="min-h-screen bg-black text-white font-sans flex items-center justify-center p-6 overflow-hidden">
        {/* Security Watermark Overlay */}
        <div className="fixed inset-0 z-0 opacity-[0.03] pointer-events-none flex flex-wrap gap-12 rotate-[-25deg] scale-150">
          {Array.from({ length: 100 }).map((_, i) => (
            <span key={i} className="text-[10px] font-black whitespace-nowrap uppercase tracking-[0.3em]">
              OFFICIAL M2M SECURE SESSION
            </span>
          ))}
        </div>

        <div className="fixed inset-0 bg-black pointer-events-none" />
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative z-10 w-full max-w-md bg-[#080808] border-2 border-[#2d2d2d] rounded-[2.5rem] p-8 text-center shadow-2xl"
        >
          {/* Live Security Clock - Larger & High Contrast */}
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[#111] border-2 border-[#66FFB2] px-6 py-2 rounded-full shadow-[0_0_15px_rgba(102,255,178,0.2)]">
            <p className="text-[11px] font-black text-[#66FFB2] tracking-widest uppercase">
              {currentTime.toLocaleDateString()} | {currentTime.toLocaleTimeString()}
            </p>
          </div>

          <motion.div 
            animate={{ 
              scale: [1, 1.2, 1],
              opacity: [0.8, 1, 0.8]
            }}
            transition={{ 
              duration: 1.5, 
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="w-24 h-24 bg-[#66FFB2]/10 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(102,255,178,0.1)]"
          >
            <CheckCircle2 className="w-14 h-14 text-[#66FFB2] drop-shadow-[0_0_10px_rgba(102,255,178,0.5)]" />
          </motion.div>
          
          <h1 className="text-3xl font-black tracking-tighter mb-2 uppercase text-[#66FFB2]">Order Finalized</h1>
          <p className="text-gray-400 text-[11px] mb-8 uppercase tracking-widest font-bold">Please follow these final steps before leaving:</p>
          
          {/* Instruction Grid */}
          <div className="space-y-4 mb-8 text-left">
            <div className="flex items-start gap-4 bg-[#111] p-4 rounded-2xl border border-[#222]">
              <div className="w-10 h-10 bg-[#66FFB2]/10 rounded-xl flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-[#66FFB2]" />
              </div>
              <p className="text-[13px] font-bold text-[#F0F0F0] leading-snug">
                Show this screen to the Shop Attendant for verification.
              </p>
            </div>

            <div className="flex items-start gap-4 bg-[#111] p-4 rounded-2xl border border-[#222]">
              <div className="w-10 h-10 bg-[#66FFB2]/10 rounded-xl flex items-center justify-center shrink-0">
                <Edit3 className="w-5 h-5 text-[#66FFB2]" />
              </div>
              <p className="text-[13px] font-bold text-[#F0F0F0] leading-snug">
                Write the <span className="text-[#66FFB2]">DIGITS ONLY</span> clearly on any blank spot of your shipping label.
              </p>
            </div>

            <div className="flex items-start gap-4 bg-[#111] p-4 rounded-2xl border border-[#222]">
              <div className="w-10 h-10 bg-[#66FFB2]/10 rounded-xl flex items-center justify-center shrink-0">
                <Shield className="w-5 h-5 text-[#66FFB2]" />
              </div>
              <p className="text-[13px] font-bold text-[#F0F0F0] leading-snug">
                Ensure your box is fully secured and taped before handing it over.
              </p>
            </div>
          </div>

          {/* Identity & Order ID Focus */}
          <div className="bg-black rounded-3xl p-6 border-2 border-[#222] mb-8 shadow-xl">
            <div className="mb-4">
              <p className="text-[16px] font-black text-white uppercase tracking-tight">
                {session?.name || 'VERIFIED CUSTOMER'}
              </p>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                {obfuscateEmail(session?.email || '')}
              </p>
            </div>
            
            <div className="h-px bg-[#222] w-full mb-4" />

            <p className="text-[10px] text-gray-500 uppercase tracking-[0.3em] mb-3 font-black">Order ID Reference</p>
            <motion.p 
              animate={{ 
                textShadow: [
                  "0 0 5px rgba(102,255,178,0.2)",
                  "0 0 15px rgba(102,255,178,0.6)",
                  "0 0 5px rgba(102,255,178,0.2)"
                ]
              }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              className="text-[44px] font-black text-[#66FFB2] leading-none tracking-tighter"
            >
              M2M-{successOrderId || 'XXXXXX'}
            </motion.p>
          </div>

          <button 
            onClick={() => window.location.href = '/'}
            className="w-full py-5 bg-[#66FFB2] text-black rounded-2xl font-black uppercase tracking-widest hover:scale-[1.02] transition-transform shadow-lg"
          >
            Finish
          </button>
        </motion.div>
      </div>
    );
  }

  if (mode === 'intake') {
    return (
      <div className="min-h-screen bg-[#000000] text-white font-sans flex flex-col items-center justify-center p-6">
        <div className="fixed inset-0 bg-[radial-gradient(circle_at_center,_#121212_0%,_#000000_100%)] pointer-events-none" />
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 w-full max-w-md bg-[#1a1a1a]/80 backdrop-blur-xl border border-[#2d2d2d] rounded-3xl p-8 shadow-2xl"
        >
          <header className="text-center mb-8">
            <h1 className="text-2xl font-black tracking-tighter text-[#66FFB2] uppercase">Customer Intake</h1>
            <p className="text-[10px] text-[#F0F0F0] uppercase tracking-widest mt-2 px-4 leading-relaxed font-bold">
              SECURE CONTACT DETAILS: Accurate information is required to ensure your order and accountability photos are processed correctly.
            </p>
          </header>

          <form onSubmit={handleIntakeSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider ml-1">First Name</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input 
                  required
                  type="text"
                  value={intakeData.firstName}
                  onChange={e => setIntakeData({...intakeData, firstName: e.target.value})}
                  className="w-full bg-black/50 border border-[#2d2d2d] rounded-xl py-4 pl-12 pr-4 focus:border-[#66FFB2] focus:outline-none transition-colors"
                  placeholder="John"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider ml-1">Last Name</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input 
                  required
                  type="text"
                  value={intakeData.lastName}
                  onChange={e => setIntakeData({...intakeData, lastName: e.target.value})}
                  className="w-full bg-black/50 border border-[#2d2d2d] rounded-xl py-4 pl-12 pr-4 focus:border-[#66FFB2] focus:outline-none transition-colors"
                  placeholder="Doe"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider ml-1">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input 
                  required
                  type="email"
                  value={intakeData.email}
                  onChange={e => setIntakeData({...intakeData, email: e.target.value})}
                  className="w-full bg-black/50 border border-[#2d2d2d] rounded-xl py-4 pl-12 pr-4 focus:border-[#66FFB2] focus:outline-none transition-colors"
                  placeholder="john@example.com"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider ml-1">Phone Number</label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input 
                  required
                  type="tel"
                  value={intakeData.phone}
                  onChange={e => setIntakeData({...intakeData, phone: e.target.value})}
                  className="w-full bg-black/50 border border-[#2d2d2d] rounded-xl py-4 pl-12 pr-4 focus:border-[#66FFB2] focus:outline-none transition-colors"
                  placeholder="(555) 000-0000"
                />
              </div>
            </div>

            <button 
              type="submit"
              disabled={!isIntakeValid}
              className={`w-full py-5 rounded-2xl font-black uppercase tracking-widest mt-6 flex items-center justify-center gap-2 transition-all duration-300 ${
                isIntakeValid 
                  ? 'bg-[#66FFB2] text-black shadow-[0_0_20px_rgba(102,255,178,0.4)] hover:scale-[1.02]' 
                  : 'bg-[#1a1a1a] text-[#444] opacity-40 cursor-not-allowed border border-[#2d2d2d]'
              }`}
            >
              {isIntakeValid ? 'Start Capture' : 'Please Fill All Fields'}
              <ArrowRight className="w-5 h-5" />
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-black text-white font-sans flex flex-col overflow-hidden">
      {/* Solid Black Background for maximum contrast */}
      <div className="fixed inset-0 bg-black pointer-events-none" />

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

      <main className="relative z-10 w-full max-w-md mx-auto h-full flex flex-col p-4 gap-4">
        {/* Compressed Header */}
        <header className="relative text-center shrink-0">
          <button 
            onClick={() => setMode('intake')}
            className="absolute left-0 top-1/2 -translate-y-1/2 p-2 text-gray-500 hover:text-[#66FFB2] transition-colors"
            title="Back to Intake"
          >
            <ArrowRight className="w-5 h-5 rotate-180" />
          </button>
          <motion.h1 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-[22px] font-black tracking-[0.1em] text-[#66FFB2] uppercase drop-shadow-[0_0_8px_rgba(102,255,178,0.4)]"
          >
            M2M PHOTO BRIDGE
          </motion.h1>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[9px] text-[#888] tracking-[0.1em] uppercase flex justify-center gap-4 mt-0.5"
          >
            <div>STORE: <span className="text-gray-300 font-bold">{session?.storecode}</span></div>
            <div>SESSION: <span className="text-gray-300 font-bold">{session?.sessionid}</span></div>
          </motion.div>
        </header>

        {/* Slim Instruction Banner */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-[#111] border-2 border-[#2d2d2d] border-l-[#66FFB2] rounded-lg py-2.5 px-3 flex items-center gap-2 shrink-0"
        >
          <Shield className="w-4 h-4 text-[#66FFB2]" />
          <p className="text-[12px] font-black text-white uppercase tracking-tight">
            Items (1-4) & Tracking Label (1)
          </p>
        </motion.div>

        {/* 4:3 Camera Feed (Stretched vertically) */}
        <div className="relative aspect-[4/3] rounded-2xl overflow-hidden border-2 border-[#333] bg-black shadow-[0_0_20px_rgba(0,0,0,0.8)] shrink-0">
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/webp"
            videoConstraints={{
              facingMode: "environment",
              width: 1280,
              height: 720
            }}
            className="w-full h-full object-cover"
          />
          
          {/* Dual Action Buttons with High Contrast & Glow */}
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4 px-4">
            <button 
              onClick={() => handleCapture('item')}
              disabled={itemPhotos.length >= 4}
              className="flex-1 py-4 bg-black/60 backdrop-blur-xl border-2 border-white/40 rounded-xl flex flex-col items-center gap-1 active:scale-95 transition-all disabled:opacity-20 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
            >
              <Package className="w-6 h-6 text-[#66FFB2] drop-shadow-[0_0_5px_rgba(102,255,178,0.5)]" />
              <span className="text-[10px] font-black text-white uppercase tracking-widest">Add Item</span>
            </button>
            
            <button 
              onClick={() => handleCapture('label')}
              disabled={!!labelPhoto}
              className="flex-1 py-4 bg-[#66FFB2]/20 backdrop-blur-xl border-2 border-[#66FFB2]/60 rounded-xl flex flex-col items-center gap-1 active:scale-95 transition-all disabled:opacity-20 shadow-[0_0_15px_rgba(102,255,178,0.2)]"
            >
              <Barcode className="w-6 h-6 text-[#66FFB2] drop-shadow-[0_0_5px_rgba(102,255,178,0.5)]" />
              <span className="text-[10px] font-black text-white uppercase tracking-widest">Add Label</span>
            </button>
          </div>
        </div>

        {/* Dynamic Grid (Stretched to fill space) */}
        <div className="flex flex-col gap-3 flex-grow overflow-hidden justify-center">
          <div className="grid grid-cols-5 gap-3">
            <AnimatePresence mode="popLayout">
              {/* Item Slots (1-4) */}
              {[0, 1, 2, 3].map((idx) => {
                const photo = itemPhotos[idx];
                return (
                  <motion.div
                    key={`item-${idx}`}
                    layout
                    className={`relative aspect-square rounded-xl overflow-hidden border-2 ${photo ? 'border-[#66FFB2]' : 'border-[#E0FFE0]/60 border-dashed'} bg-[#080808] flex flex-col items-center justify-center shadow-lg`}
                  >
                    {photo ? (
                      <>
                        <img src={photo.url} alt="Item" className="w-full h-full object-cover" />
                        <button onClick={() => removePhoto(photo.id)} className="absolute top-1 right-1 p-1 bg-red-600 rounded-full z-10 shadow-md">
                          <Trash2 className="w-3 h-3 text-white" />
                        </button>
                        {photo.status === 'syncing' && (
                          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                            <Loader2 className="w-5 h-5 text-[#66FFB2] animate-spin" />
                          </div>
                        )}
                      </>
                    ) : (
                      <Package className="w-6 h-6 text-[#E0FFE0]/40" />
                    )}
                  </motion.div>
                );
              })}

              {/* Dedicated Label Slot - High Prominence */}
              <motion.div
                layout
                className={`relative aspect-square rounded-xl overflow-hidden border-2 ${labelPhoto ? 'border-[#66FFB2]' : 'border-[#66FFB2] border-dotted'} bg-[#080808] flex flex-col items-center justify-center shadow-[0_0_10px_rgba(102,255,178,0.1)]`}
              >
                {labelPhoto ? (
                  <>
                    <img src={labelPhoto.url} alt="Label" className="w-full h-full object-cover" />
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-[#66FFB2] text-black text-[7px] font-black rounded uppercase shadow-sm">Label</div>
                    <button onClick={() => removePhoto(labelPhoto.id)} className="absolute top-1 right-1 p-1 bg-red-600 rounded-full z-10 shadow-md">
                      <Trash2 className="w-3 h-3 text-white" />
                    </button>
                    {labelPhoto.status === 'syncing' && (
                      <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-[#66FFB2] animate-spin" />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <Barcode className="w-8 h-8 text-[#66FFB2]/40" />
                    <span className="text-[6px] font-black text-[#66FFB2]/60 uppercase tracking-tighter">Label</span>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {error && (
            <p className="text-red-500 text-[11px] font-black uppercase text-center drop-shadow-sm">{error}</p>
          )}
        </div>

        {/* Action Footer (Always Visible) */}
        <div className="mt-auto flex flex-col gap-3 pb-2 shrink-0">
          <button
            onClick={handleHandoff}
            disabled={!allPhotosReady}
            className="w-full py-5 bg-[#66FFB2] text-black rounded-2xl text-base font-black uppercase tracking-widest transition-all active:scale-[0.98] disabled:bg-[#111] disabled:text-[#333] disabled:border-[#222] disabled:border-2 flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(102,255,178,0.3)]"
          >
            {!allPhotosReady && photos.length > 0 ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Syncing Data...</span>
              </>
            ) : (
              <>
                <span>Complete & Proceed</span>
                <ExternalLink className="w-5 h-5" />
              </>
            )}
          </button>
          
          <div className="text-center">
            <span className="text-[11px] text-[#666] font-black uppercase tracking-[0.2em]">
              {session?.name || 'N/A'}
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
