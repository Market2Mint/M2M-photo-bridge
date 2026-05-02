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

  const [cameraError, setCameraError] = useState<string | null>(null);

  const webcamRef = useRef<Webcam>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    
    if (params.get('status') === 'success') {
      setSuccessOrderId(params.get('orderId'));
      
      // Data Recovery: Precise Parameter Mapping per Final Specs
      const name = params.get('name') || '';
      const totalAmount = params.get('totalAmount') || '';
      const reportid1 = params.get('reportid1') || params.get('reportId1') || params.get('uniqueId') || '';
      const email = params.get('email') || '';
      const phoneNumber = params.get('phoneNumber') || '';
      const sessionid = params.get('sessionid') || '';
      const storecode = params.get('storecode') || '';

      if (name || totalAmount || reportid1) {
        setSession({
          sessionid: sessionid.toUpperCase().trim(),
          name,
          email,
          phoneNumber,
          totalAmount,
          reportid1,
          storecode: storecode.toLowerCase().trim(),
          date: params.get('date') || new Date().toISOString().split('T')[0],
          servicesOrdered: params.get('servicesOrdered') || '',
          totalamountBridge: totalAmount,
          customernotes: params.get('customernotes') || '',
        });
      }

      setPhotos([]); // Clear local cart on success
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
    const { name, totalAmount, servicesOrdered, reportid1 } = session;
    
    const basePrice = parseFloat(totalAmount) || 0;
    const formattedPrice = basePrice.toFixed(2);

    // PCI Compliant JotForm URL with simplified mapping
    const jotformUrl = `https://pci.jotform.com/form/261217230124139?uniqueId1=${encodeURIComponent(reportid1)}&name=${encodeURIComponent(name)}&totalAmount=${formattedPrice}&servicesOrdered=${encodeURIComponent(servicesOrdered)}`;

    window.location.href = jotformUrl;
  };

  const isSyncing = photos.some(p => p.status === 'syncing');
  const hasItem = photos.some(p => p.type === 'item' && p.status === 'ready');
  const hasLabel = photos.some(p => p.type === 'label' && p.status === 'ready');
  const allPhotosReady = (hasItem || hasLabel) && !isSyncing;

  const itemPhotos = photos.filter(p => p.type === 'item');
  const labelPhoto = photos.find(p => p.type === 'label');

  const obfuscateEmail = (email: string) => {
    if (!email) return 'N/A';
    const [name, domain] = email.split('@');
    if (!domain) return email;
    return `${name[0]}***@${domain}`;
  };

  if (mode === 'success') {
    const params = new URLSearchParams(window.location.search);
    // Precise Mapping per Final Specification: reportid1, name, totalAmount
    const displayId = (params.get('reportid1') || params.get('reportId1') || session?.reportid1 || '000000').replace('M2M-', '');
    const displayName = params.get('name') || session?.name || 'Customer Verified';
    const displayTotal = params.get('totalAmount') || session?.totalAmount || '0.00';
    
    return (
      <div className="h-screen w-full bg-black text-white font-sans flex flex-col items-center justify-start p-0 overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_#052515_0%,_#000_100%)] pointer-events-none opacity-50" />
        
        <div className="relative z-10 w-full flex flex-col items-center px-4 pt-6">
          {/* Top Row: Live Clock */}
          <div className="mb-4 py-1.5 px-6 bg-[#0A0A0A] border border-[#66FFB2]/20 rounded-full shadow-lg">
            <p className="text-[14px] font-black text-[#66FFB2] tracking-[0.2em] font-mono">
              {currentTime.toLocaleTimeString([], { hour12: true })}
            </p>
          </div>

          {/* Static Primary Instruction - No Pulse */}
          <div className="mb-4 w-full px-2">
            <p className="text-[17px] font-black text-emerald-400 uppercase tracking-tighter text-center leading-tight">
              SHOW THIS SCREEN TO THE SHOP ATTENDANT
            </p>
          </div>

          {/* The Six-Digit 'Heavy Beat' Hero Focus */}
          <motion.div 
            animate={{ 
              scale: [1, 1.05, 1],
              boxShadow: [
                "0 0 10px rgba(102,255,178,0.1)",
                "0 0 50px rgba(102,255,178,0.4)",
                "0 0 10px rgba(102,255,178,0.1)"
              ],
              borderColor: [
                "rgba(102,255,178,0.2)",
                "rgba(102,255,178,0.8)",
                "rgba(102,255,178,0.2)"
              ]
            }}
            transition={{ 
              duration: 1.2, 
              repeat: Infinity, 
              ease: "easeInOut" 
            }}
            className="w-full bg-[#080808] border-2 rounded-[40px] py-8 mb-6 text-center relative overflow-hidden flex flex-col items-center justify-center"
          >
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#66FFB2] to-transparent" />
            <p className="text-[11px] font-black text-[#66FFB2]/50 uppercase tracking-[0.7em] mb-4">Verification Active</p>
            <h2 className="text-[75px] sm:text-[95px] font-black text-white leading-none tracking-tight block w-full px-2 break-all overflow-hidden">
              {displayId}
            </h2>
          </motion.div>

          {/* Condensed Secondary Data Pills - Full Screen Width */}
          <div className="w-full space-y-2 mb-6 px-1">
            <div className="bg-[#0A0A0A] border border-white/5 py-3 px-6 rounded-2xl flex justify-between items-center w-full shadow-2xl">
              <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Verified Customer</span>
              <span className="text-[18px] font-black text-white uppercase tracking-tight">{displayName}</span>
            </div>
            
            <div className="bg-[#0A0A0A] border border-white/5 py-3 px-6 rounded-2xl flex justify-between items-center w-full shadow-2xl">
              <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Total Paid</span>
              <span className="text-[26px] font-black text-[#66FFB2] tracking-tighter">
                ${parseFloat(displayTotal).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Minimalist Checklist One-Liners */}
          <div className="w-full space-y-3 px-4">
            <div className="flex items-center gap-4">
              <div className="p-1 bg-emerald-500/10 rounded-full">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              </div>
              <p className="text-[14px] font-bold text-gray-400 uppercase tracking-wide">Write the {displayId.length} digits on your label</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="p-1 bg-emerald-500/10 rounded-full">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              </div>
              <p className="text-[14px] font-bold text-gray-400 uppercase tracking-wide">Hand your secured box to staff</p>
            </div>
          </div>
        </div>

        {/* Dynamic Security Heartbeat - Fixed Bottom Watermark */}
        <div className="absolute bottom-8 left-0 right-0 text-center opacity-40">
          <p className="text-[9px] font-black text-[#66FFB2] uppercase tracking-[0.8em]">Security Authenticated: Session Live</p>
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
    <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-x-hidden relative">
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
      <header className="fixed top-0 inset-x-0 h-[60px] bg-black/80 backdrop-blur-md border-b border-[#1A1A1A] flex items-center px-4 shrink-0 z-50">
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

      <main className="flex-1 flex flex-col pt-[60px] pb-32">
        {/* Taller Viewfinder - Professional Lens Style */}
        <div className="relative h-[55vh] w-full bg-[#080808] border-b border-[#66FFB2]/30 shadow-[0_0_20px_rgba(102,255,178,0.1)] overflow-hidden shrink-0 z-30">
          <Webcam
            audio={false}
            muted
            playsInline
            ref={webcamRef}
            screenshotFormat="image/webp"
            onUserMedia={() => setCameraError(null)}
            onUserMediaError={(err: any) => {
              console.error("Camera Error:", err);
              setCameraError(err.toString());
            }}
            videoConstraints={{
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }}
            className="w-full h-full object-cover"
          />
          
          {cameraError && (
            <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center z-50">
              <Camera className="w-12 h-12 text-red-500 mb-4 opacity-50" />
              <p className="text-red-500 font-black uppercase tracking-widest text-[10px] mb-2">Camera Access Failed</p>
              <p className="text-gray-400 text-[8px] uppercase tracking-wider max-w-[200px] leading-relaxed">
                {cameraError.includes('NotAllowedError') 
                  ? 'Please enable camera permissions in your browser settings and refresh.' 
                  : 'Your device may not support the requested camera mode. Try refreshing the app.'}
              </p>
            </div>
          )}

          <div className="absolute top-4 left-4">
             <div className="bg-black/80 backdrop-blur-md border border-white/10 px-4 py-2 rounded-full flex items-center gap-2 shadow-2xl">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] font-black text-white uppercase tracking-[0.2em] whitespace-nowrap">Live Stream</span>
             </div>
          </div>

          <div className="absolute top-4 right-4">
             <div className="bg-black/80 backdrop-blur-md border border-white/10 px-4 py-2 rounded-full flex flex-col items-center shadow-2xl min-w-[60px]">
                <span className="text-[14px] font-black text-[#66FFB2] uppercase leading-none font-mono">
                  {itemPhotos.length} / 4
                </span>
                <span className="text-[8px] font-bold text-white/40 uppercase tracking-tighter mt-0.5">Items</span>
             </div>
          </div>
        </div>

        {/* High-Impact Action Buttons - Vertical Stack - Tighter Padding */}
        <div className="px-6 py-6 flex flex-col gap-3">
          <button 
            onClick={() => handleCapture('item')}
            disabled={itemPhotos.length >= 4}
            className="w-full h-24 bg-white/5 backdrop-blur-md border-2 border-white/10 rounded-2xl flex items-center justify-between px-8 active:scale-[0.98] transition-all disabled:opacity-20 shadow-2xl relative group overflow-hidden"
          >
            <div className="flex items-center gap-6">
              <div className="p-3 bg-white/10 rounded-xl group-active:scale-90 transition-transform">
                <Camera className="w-8 h-8 text-[#66FFB2]" />
              </div>
              <div className="flex flex-col items-start leading-tight">
                <span className="text-[18px] font-bold text-white uppercase tracking-wider">Snap Item Photo</span>
                <span className="text-[11px] font-bold text-[#66FFB2] uppercase tracking-[0.2em] mt-1">For Reference</span>
              </div>
            </div>
            <div className="absolute right-0 top-0 bottom-0 w-1 bg-[#66FFB2] opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          
          <button 
            onClick={() => handleCapture('label')}
            disabled={!!labelPhoto}
            className="w-full h-24 bg-[#66FFB2]/5 backdrop-blur-md border-2 border-[#66FFB2]/30 rounded-2xl flex items-center justify-between px-8 active:scale-[0.98] transition-all disabled:opacity-20 shadow-2xl relative group overflow-hidden"
          >
            <div className="flex items-center gap-6">
              <div className="p-3 bg-[#66FFB2]/10 rounded-xl group-active:scale-90 transition-transform">
                <Barcode className="w-8 h-8 text-[#66FFB2]" />
              </div>
              <div className="flex flex-col items-start leading-tight">
                <span className="text-[18px] font-bold text-white uppercase tracking-wider">Snap Shipping Label</span>
                <span className="text-[11px] font-bold text-[#66FFB2] uppercase tracking-[0.2em] mt-1">For Tracking</span>
              </div>
            </div>
            <div className={`p-1.5 rounded-full ${labelPhoto ? 'bg-[#66FFB2]' : 'bg-white/10'}`}>
              <CheckCircle2 className={`w-5 h-5 ${labelPhoto ? 'text-black' : 'text-white/20'}`} />
            </div>
            <div className="absolute right-0 top-0 bottom-0 w-1 bg-[#66FFB2] opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>

          <p className="text-[10px] font-bold text-emerald-500/80 uppercase tracking-widest text-center mt-1">
            FOR REFERENCE ONLY. CONSOLIDATE YOUR ITEMS.
          </p>
        </div>

        {/* Captured Gallery - Compact Horizontal Row */}
        <div className="px-6 pb-6 overflow-x-auto">
          <div className="flex gap-4 pb-4">
            <AnimatePresence mode="popLayout">
              {[0, 1, 2, 3].map((idx) => {
                const photo = itemPhotos[idx];
                return (
                  <motion.div
                    key={`item-${idx}`}
                    layout
                    className={`relative w-28 h-28 flex-shrink-0 rounded-[12px] overflow-hidden border-2 transition-all duration-500 ${photo ? 'border-[#66FFB2]/50 shadow-[0_0_15px_rgba(102,255,178,0.2)]' : 'border-gray-800 border-dashed'} bg-[#050505] flex items-center justify-center`}
                  >
                    {photo ? (
                      <>
                        <img src={photo.url} alt="Item" className="w-full h-full object-cover" />
                        <button onClick={() => removePhoto(photo.id)} className="absolute top-2 right-2 p-1.5 bg-black/80 backdrop-blur-md rounded-full z-10 border border-white/10 shadow-xl active:scale-90 transition-transform">
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </button>
                        {photo.status === 'ready' && (
                          <div className="absolute top-2 left-2 p-1 bg-[#66FFB2] rounded-full z-10 shadow-[0_0_10px_#66FFB2]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-black" />
                          </div>
                        )}
                        {photo.status === 'syncing' && (
                          <div className="absolute inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center">
                            <Loader2 className="w-6 h-6 text-[#66FFB2] animate-spin" />
                          </div>
                        )}
                        {photo.status === 'error' && (
                          <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center gap-1">
                             <p className="text-[8px] font-black text-red-500 uppercase tracking-widest leading-none">Fail</p>
                             <button 
                               onClick={() => retryPhoto(photo)}
                               className="bg-white text-black px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest active:scale-95 transition-transform"
                             >
                               Retry
                             </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-1 opacity-20">
                        <Package className="w-6 h-6 text-gray-500" />
                        <span className="text-[8px] font-black uppercase tracking-widest text-gray-500">Item {idx + 1}</span>
                      </div>
                    )}
                  </motion.div>
                );
              })}

              <motion.div
                layout
                className={`relative w-28 h-28 flex-shrink-0 rounded-[12px] overflow-hidden border-2 transition-all duration-500 ${labelPhoto ? 'border-[#66FFB2] shadow-[0_0_15px_rgba(102,255,178,0.3)]' : 'border-gray-800 border-dotted'} bg-[#050505] flex items-center justify-center`}
              >
                {labelPhoto ? (
                  <>
                    <img src={labelPhoto.url} alt="Label" className="w-full h-full object-cover" />
                    <button onClick={() => removePhoto(labelPhoto.id)} className="absolute top-2 right-2 p-1.5 bg-black/80 backdrop-blur-md rounded-full z-10 border border-white/10 shadow-xl active:scale-90 transition-transform">
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </button>
                    {labelPhoto.status === 'ready' && (
                      <div className="absolute top-2 left-2 p-1 bg-[#66FFB2] rounded-full z-10 shadow-[0_0_10px_#66FFB2]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-black" />
                      </div>
                    )}
                    {labelPhoto.status === 'syncing' && (
                      <div className="absolute inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center">
                        <Loader2 className="w-6 h-6 text-[#66FFB2] animate-spin" />
                      </div>
                    )}
                    {labelPhoto.status === 'error' && (
                      <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center gap-1">
                         <p className="text-[8px] font-black text-red-500 uppercase tracking-widest leading-none">Fail</p>
                         <button 
                           onClick={() => retryPhoto(labelPhoto)}
                           className="bg-white text-black px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest active:scale-95 transition-transform"
                         >
                           Retry
                         </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1 opacity-20">
                    <Barcode className="w-6 h-6 text-gray-500" />
                    <span className="text-[8px] font-black uppercase tracking-widest text-gray-500">Label</span>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Data Context */}
        <div className="px-6 pb-6">
          <div className="bg-[#0A0A0A] border-2 border-white/5 p-5 rounded-[24px] shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <div className="flex flex-col">
                <span className="text-[14px] font-black text-gray-500 uppercase tracking-widest mb-1">Store Code</span>
                <span className="text-[16px] font-black text-white uppercase tracking-widest font-mono">{session?.storecode}</span>
              </div>
              <div className="h-10 w-[2px] bg-white/5" />
              <div className="flex flex-col items-end">
                <span className="text-[14px] font-black text-gray-500 uppercase tracking-widest mb-1">Session ID</span>
                <span className="text-[16px] font-black text-white uppercase tracking-widest font-mono">{session?.sessionid}</span>
              </div>
            </div>
            <div className="pt-4 border-t border-white/5 flex items-center justify-between">
              <span className="text-[16px] font-bold text-[#66FFB2] tracking-wider truncate uppercase">
                {session?.name || 'GUEST USER'}
              </span>
              <Edit3 className="w-5 h-5 text-gray-500 opacity-50" />
            </div>
          </div>
        </div>
      </main>

      {/* Sticky Bottom Bar - iOS Blur Style */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-black/30 backdrop-blur-xl border-t border-white/5 z-50">
        <button
          onClick={handleHandoff}
          disabled={!allPhotosReady}
          className={`
            w-full py-6 rounded-2xl text-[14px] font-extrabold uppercase tracking-[0.25em] transition-all relative overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.4)]
            ${allPhotosReady 
              ? 'bg-[#66FFB2] text-black active:scale-[0.97]' 
              : 'bg-[#111] text-gray-600 border border-white/5 cursor-not-allowed'}
          `}
        >
          <span className="relative z-10 whitespace-nowrap">
            {isSyncing ? 'Processing Assets...' : 'Complete & Proceed'}
          </span>
          {isSyncing && (
            <motion.div 
              className="absolute inset-0 bg-white/20"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
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
