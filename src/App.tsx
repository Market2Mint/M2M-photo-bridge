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
      const uniqueId = params.get('uniqueId') || params.get('reportid1') || params.get('reportId1') || `M2M-${Math.floor(100000 + Math.random() * 900000)}`;
      const email = params.get('email') || '';
      const phoneNumber = params.get('phoneNumber') || '';
      const sessionid = params.get('sessionid') || '';
      const storecode = params.get('storecode') || '';

      if (name || totalAmount || uniqueId) {
        setSession({
          sessionid: sessionid.toUpperCase().trim(),
          name,
          email,
          phoneNumber,
          totalAmount,
          uniqueId,
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

    // Sync intake form with URL params and LocalStorage Recovery
    const storedUniqueId = localStorage.getItem('m2m_uniqueId');
    const { fName: urlFName, lName: urlLName } = splitName(params.get('name') || '');
    
    // Recover from URL params or localStorage
    const firstName = urlFName || localStorage.getItem('m2m_firstName') || '';
    const lastName = urlLName || localStorage.getItem('m2m_lastName') || '';
    const email = params.get('email') || localStorage.getItem('m2m_email') || '';
    const phoneNumber = params.get('phoneNumber') || localStorage.getItem('m2m_phone') || '';
    const totalAmount = params.get('totalAmount') || localStorage.getItem('m2m_totalAmount') || '';

    setIntakeData({
        firstName,
        lastName,
        email,
        phone: phoneNumber,
    });
    
    const sessionData: SessionData = {
      sessionid: (params.get('sessionid') || generateSessionId()).toUpperCase().trim(),
      name: `${firstName} ${lastName}`.trim(),
      email,
      phoneNumber,
      totalAmount,
      uniqueId: params.get('uniqueId') || params.get('reportid1') || params.get('reportId1') || storedUniqueId || `M2M-${Math.floor(100000 + Math.random() * 900000)}`,
      storecode: (params.get('storecode') || 'DEFAULT').toLowerCase().trim(),
      date: params.get('date') || new Date().toISOString().split('T')[0],
      servicesOrdered: params.get('servicesOrdered') || '',
      totalamountBridge: params.get('totalamountBridge') || '',
      customernotes: params.get('customernotes') || '',
    };
    setSession(sessionData);

    // PERSISTENCE: Save core data to localStorage immediately
    localStorage.setItem('m2m_firstName', firstName);
    localStorage.setItem('m2m_lastName', lastName);
    localStorage.setItem('m2m_email', email);
    localStorage.setItem('m2m_phone', phoneNumber);
    localStorage.setItem('m2m_totalAmount', totalAmount);
    localStorage.setItem('m2m_uniqueId', sessionData.uniqueId);

    if (!firstName || !email || !phoneNumber) {
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

      const photoId = `photo-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const newPhoto: PhotoData = {
        id: photoId,
        url: imageSrc,
        status: 'syncing',
        timestamp: Date.now(),
        type,
      };

      setPhotos((prev) => [...prev, newPhoto]);
      processAndUpload(imageSrc, photoId, type);
    } else {
      console.warn('Capture failed: No screenshot available');
      setError('Camera not ready. Please wait a second and try again.');
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
      maxSizeMB: 0.15, // Faster compression
      maxWidthOrHeight: 1200, // Optimized for speed
      useWebWorker: true,
      fileType: 'image/jpeg' as string,
      initialQuality: 0.6, // Faster initial pass
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
      const fullName = `${intakeData.firstName} ${intakeData.lastName}`;
      setSession({
        ...session,
        name: fullName,
        email: intakeData.email,
        phoneNumber: intakeData.phone,
      });

      // PERSISTENCE: Save updated details to localStorage
      localStorage.setItem('m2m_firstName', intakeData.firstName);
      localStorage.setItem('m2m_lastName', intakeData.lastName);
      localStorage.setItem('m2m_email', intakeData.email);
      localStorage.setItem('m2m_phone', intakeData.phone);
      
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

  const handleHandoff = async () => {
    if (!session || isSyncing || isUploading) return;
    
    setIsUploading(true);
    try {
      // DATA RECOVERY: Attempt to retrieve from localStorage to survive mobile memory wipes
      const firstName = localStorage.getItem('m2m_firstName') || intakeData.firstName.trim() || '';
      const lastName = localStorage.getItem('m2m_lastName') || intakeData.lastName.trim() || '';
      const email = localStorage.getItem('m2m_email') || intakeData.email.trim() || '';
      const phone = localStorage.getItem('m2m_phone') || intakeData.phone.trim() || '';
      
      const uniqueId = localStorage.getItem('m2m_uniqueId') || session.uniqueId || '';
      const totalAmount = localStorage.getItem('m2m_totalAmount') || session.totalAmount || '0.00';
      const { servicesOrdered } = session;
      
      // --- Services Formatting Logic ---
      const rawServices = (servicesOrdered || '').replace(/\+/g, ' ');
      const serviceItems = rawServices.split('|').map(s => s.trim()).filter(Boolean);
      
      const formattedServices = serviceItems.map(item => {
        if (item.toLowerCase().includes('shipping') || item.toLowerCase().includes('insurance')) {
          return item;
        }
        return `- ${item}`;
      }).join('\n');
      
      const basePrice = parseFloat(totalAmount) || 0;
      const formattedPrice = basePrice.toFixed(2);

      // PRODUCTION URL: Finalized Linkage for JotForm Bridge
      const baseUrl = `https://pci.jotform.com/261217230124139`;
      const url = `${baseUrl}?` +
        `uniqueId=${encodeURIComponent(uniqueId)}` +
        `&totalAmount=${encodeURIComponent(formattedPrice)}` +
        `&name[first]=${encodeURIComponent(firstName)}` +
        `&name[last]=${encodeURIComponent(lastName)}` +
        `&email=${encodeURIComponent(email)}` +
        `&phoneNumber=${encodeURIComponent(phone)}` +
        `&servicesOrdered=${encodeURIComponent(formattedServices)}`;

      console.log('PRODUCTION HANDOFF TRIGGERED:', url);
      
      // PRODUCTION CLEARANCE: Wipe session storage only AFTER successful setup
      localStorage.removeItem('m2m_firstName');
      localStorage.removeItem('m2m_lastName');
      localStorage.removeItem('m2m_email');
      localStorage.removeItem('m2m_phone');
      localStorage.removeItem('m2m_totalAmount');
      localStorage.removeItem('m2m_uniqueId');
      
      window.location.href = url;
    } catch (err) {
      console.error('Handoff Critical Failure:', err);
      setError('Connection interrupted. Please refresh and try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const isSyncing = photos.some(p => p.status === 'syncing');
  const hasItem = photos.some(p => p.type === 'item' && p.status === 'ready');
  const hasLabel = photos.some(p => p.type === 'label' && p.status === 'ready');
  // Both at least one item and the label are REQUIRED for the button to be available
  const allPhotosReady = hasItem && hasLabel && !isSyncing && !isUploading;

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
    // Precise Mapping per Final Specification: uniqueId, name, totalAmount
    const displayId = (params.get('uniqueId') || params.get('reportid1') || params.get('reportId1') || session?.uniqueId || '000000').replace('M2M-', '');
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
    <div className="min-h-screen w-full bg-[#000000] text-white font-sans flex flex-col relative pb-[40px]">
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

      <main className="flex-1 relative flex flex-col">
        {/* Immersive Viewfinder */}
        <div className="relative h-[85vh] w-full bg-[#000000] overflow-hidden shrink-0 z-10">
            <Webcam
              audio={false}
              muted
              playsInline
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              screenshotQuality={0.9}
              onUserMedia={() => setCameraError(null)}
              onUserMediaError={(err: any) => {
                console.error("Camera Hardware Error:", err);
                setCameraError("Camera access denied or unavailable.");
              }}
              videoConstraints={{
                facingMode: { ideal: "environment" },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
              }}
              className="w-full h-full object-cover"
            />
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/40 pointer-events-none" />

          {cameraError && (
            <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center z-50">
              <Camera className="w-12 h-12 text-red-500 mb-4 opacity-50" />
              <p className="text-red-500 font-black uppercase tracking-widest text-[10px] mb-2">Camera Access Failed</p>
              <p className="text-gray-400 text-[8px] uppercase tracking-wider max-w-[200px] leading-relaxed">
                Enable camera permissions in settings.
              </p>
            </div>
          )}

          {/* Floating Header Overlays */}
          <div className="absolute top-6 left-6 flex flex-col gap-1">
             <button 
               onClick={() => setMode('intake')}
               className="p-3 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full text-white active:scale-90 transition-all shadow-2xl"
             >
               <ArrowLeft className="w-5 h-5" />
             </button>
          </div>

          <div className="absolute top-6 right-6">
             <div className="bg-black/60 backdrop-blur-xl border border-white/20 px-5 py-2.5 rounded-full flex items-center gap-3 shadow-2xl">
                <span className="text-[14px] font-black text-[#00c86e] uppercase font-mono tracking-tighter">
                  {itemPhotos.length} / 4
                </span>
                <span className="text-[9px] font-bold text-white/70 uppercase tracking-[0.1em]">Photos</span>
             </div>
          </div>

          {/* Compact Gallery Strip Overlay */}
          <div className="absolute bottom-32 left-0 right-0 px-6 overflow-x-auto pointer-events-auto">
            <div className="flex gap-2 justify-center pb-2">
              <AnimatePresence mode="popLayout">
                {[0, 1, 2, 3].map((idx) => {
                  const photo = itemPhotos[idx];
                  return (
                    <motion.button
                      key={`item-overlay-${idx}`}
                      layout
                      onClick={() => !photo && handleCapture('item')}
                      disabled={!!photo}
                      className={`relative w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all duration-300 ${photo ? 'border-[#00c86e]/80 shadow-[0_0_10px_rgba(0,200,110,0.3)]' : 'border-white/10 bg-black/40'} flex items-center justify-center active:scale-95`}
                    >
                      {photo ? (
                        <>
                          <img src={photo.url} alt="Item" className="w-full h-full object-cover" />
                          <div 
                            onClick={(e) => { e.stopPropagation(); removePhoto(photo.id); }} 
                            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 active:opacity-100 transition-opacity"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </div>
                          {photo.status === 'syncing' && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                              <Loader2 className="w-4 h-4 text-[#00c86e] animate-spin" />
                            </div>
                          )}
                          {photo.status === 'error' && (
                            <div className="absolute inset-0 bg-red-900/80 flex items-center justify-center">
                              <Trash2 className="w-4 h-4 text-white" />
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Plus className="w-3 h-3 text-white/20" />
                        </div>
                      )}
                    </motion.button>
                  );
                })}
                <motion.button
                  layout
                  onClick={() => !labelPhoto && handleCapture('label')}
                  disabled={!!labelPhoto}
                  className={`relative w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all duration-300 ${labelPhoto ? 'border-[#00c86e] shadow-[0_0_10px_rgba(0,200,110,0.5)]' : 'border-white/10 bg-black/40'} flex items-center justify-center active:scale-95`}
                >
                  {labelPhoto ? (
                    <>
                      <img src={labelPhoto.url} alt="Label" className="w-full h-full object-cover" />
                      <div 
                        onClick={(e) => { e.stopPropagation(); removePhoto(labelPhoto.id); }} 
                        className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 active:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </div>
                      {labelPhoto.status === 'syncing' && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <Loader2 className="w-4 h-4 text-[#00c86e] animate-spin" />
                        </div>
                      )}
                      {labelPhoto.status === 'error' && (
                        <div className="absolute inset-0 bg-red-900/80 flex items-center justify-center">
                          <Trash2 className="w-4 h-4 text-white" />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Barcode className="w-3 h-3 text-white/20" />
                    </div>
                  )}
                </motion.button>
              </AnimatePresence>
            </div>
          </div>

          {/* Symmetrical Floating Action Hub */}
          <div className="absolute bottom-8 left-0 right-0 px-6 flex items-center justify-center gap-4 z-20">
            <button 
              onClick={() => handleCapture('item')}
              disabled={itemPhotos.length >= 4}
              className="flex-1 min-w-[160px] h-16 bg-[#00c86e] border border-white/10 rounded-full flex items-center justify-center gap-3 active:scale-95 transition-all shadow-[0_10px_30px_rgba(0,200,110,0.3)] disabled:opacity-40"
            >
              <Camera className="w-6 h-6 text-white" />
              <div className="flex flex-col items-start leading-tight">
                <span className="text-[13px] font-black text-white uppercase tracking-wider">Snap Item</span>
                <span className="text-[9px] font-bold text-white/70 uppercase tracking-widest">{itemPhotos.length}/4</span>
              </div>
            </button>

            <button 
              onClick={() => handleCapture('label')}
              disabled={!!labelPhoto}
              className="flex-1 min-w-[160px] h-16 bg-[#00c86e] border border-white/10 rounded-full flex items-center justify-center gap-3 active:scale-95 transition-all shadow-[0_10px_30px_rgba(0,200,110,0.3)] disabled:opacity-40"
            >
              <Barcode className="w-6 h-6 text-white" />
              <div className="flex flex-col items-start leading-tight">
                <span className="text-[13px] font-black text-white uppercase tracking-wider">Snap Label #'s</span>
                <span className="text-[9px] font-bold text-white/70 uppercase tracking-widest">{labelPhoto ? 'Ready' : 'Required'}</span>
              </div>
            </button>
          </div>

        </div>

        {/* Full Bleed Footer Navigation with safe area padding */}
        <div className="flex-1 bg-[#000000] flex flex-col justify-end relative z-30 pb-4">
          <div className="text-center pb-6">
            <p className="text-[10px] font-black text-[#66FFB2] uppercase tracking-[0.25em]">
              CONSOLIDATE ITEMS TO AVOID LAG
            </p>
          </div>

          <div className="flex flex-col">
            <button
              onClick={handleHandoff}
              disabled={!allPhotosReady}
              className={`
                w-full py-8 text-[16px] font-black uppercase tracking-[0.4em] transition-all relative overflow-hidden
                ${allPhotosReady 
                  ? 'bg-[#00c86e] text-white active:opacity-90 active:scale-[0.99] shadow-[0_-10px_40px_rgba(0,200,110,0.4)]' 
                  : 'bg-[#111111] text-gray-800 cursor-not-allowed'}
              `}
            >
              <span className="relative z-10">
                {(isSyncing || isUploading) ? 'Processing Assets...' : 'Complete & Proceed'}
              </span>
            </button>

            {/* Absolute Bottom Metadata Row - Read Only Lockdown */}
            <div className="bg-black/95 backdrop-blur-md flex justify-between items-center px-6 py-4 border-t border-white/10">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-black text-white/40 uppercase tracking-[0.2em] font-mono">
                  STORE
                </span>
                <span className="text-[12px] font-black text-white/80 uppercase tracking-[0.1em] font-mono">
                  {session?.storecode}
                </span>
              </div>
              
              <div className="flex flex-col gap-1 items-end">
                <span className="text-[9px] font-black text-white/40 uppercase tracking-[0.2em] font-mono">
                  ORDER ID
                </span>
                <span className="text-[13px] font-black text-[#00c86e] uppercase tracking-[0.05em] font-mono whitespace-nowrap">
                  {session?.uniqueId}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>



      {error && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] px-6 py-4 bg-red-600/90 backdrop-blur-xl rounded-2xl border border-red-500/50 shadow-2xl text-center"
        >
          <p className="text-[12px] font-black text-white uppercase tracking-[0.1em]">{error}</p>
        </motion.div>
      )}
    </div>
  );
}
