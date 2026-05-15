import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, CheckCircle2, Loader2, Plus, Trash2, ExternalLink, Camera, User, Mail, Phone, ArrowRight, ArrowLeft, Package, Barcode, Edit3 } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { signInAnonymously } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import Webcam from 'react-webcam';
import { storage, auth, db } from './firebase';
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

const CaptureWindow = ({ label, photo, onCapture, onRemove, icon: Icon, required = false, small = false }: any) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-center px-1">
        <span className="text-[11px] font-black text-[#00FF88] uppercase tracking-widest leading-none whitespace-nowrap">{label}</span>
      </div>
      <button
        onClick={() => !photo && onCapture()}
        className={`
          relative w-full aspect-square rounded-xl overflow-hidden border-2 transition-all duration-300
          ${photo ? 'border-[#00FF88] shadow-[0_0_20px_rgba(0,255,136,0.2)]' : 'border-[#00FF88]/30 bg-[#050505] active:scale-[0.98]'}
          flex flex-col items-center justify-center group
        `}
      >
        {photo ? (
          <>
            <img src={photo.url} alt={label} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
               <div 
                 onClick={(e) => { e.stopPropagation(); onRemove(); }}
                 className="p-3 bg-red-500 rounded-full text-white active:scale-90 transition-all shadow-xl cursor-pointer pointer-events-auto"
               >
                 <Trash2 className="w-6 h-6" />
               </div>
            </div>
            {photo.status === 'syncing' && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                 <Loader2 className="w-7 h-7 text-[#00FF88] animate-spin" />
                 <span className="text-[10px] font-black text-[#00FF88] uppercase tracking-widest">Syncing</span>
              </div>
            )}
            {photo.status === 'error' && (
              <div className="absolute inset-0 bg-red-900/80 flex flex-col items-center justify-center gap-2">
                 <Trash2 className="w-7 h-7 text-white" />
                 <span className="text-[10px] font-black text-white uppercase tracking-widest">Error</span>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className={`p-3 rounded-full bg-[#00FF88]/5 transition-colors ${required ? 'group-active:bg-[#00FF88]/20' : 'group-active:bg-[#00FF88]/10'}`}>
              <Icon className="w-7 h-7 text-[#00FF88]" />
            </div>
          </div>
        )}
      </button>
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
    const initialize = async () => {
      const params = new URLSearchParams(window.location.search);
      const refId = params.get('refId');

      // --- 3. PREVENTATIVE CLEANUP ---
      // On the very first line of useEffect, if a new refId is in the URL, clear old data
      if (refId) {
        localStorage.clear();
        console.log('NEW ORDER DETECTED - SCRUBBED LOCALSTORAGE');
      }

      // --- EMERGENCY PERSISTENCE: RE-TATTOO CURRENT PARAMS ---
      if (params.toString()) {
        params.forEach((value, key) => {
          localStorage.setItem(key, value);
        });
      }

      // 1. THE FIREBASE RETRIEVAL BRIDGE (Background Data Sync)
      if (refId) {
        // ASYNCHRONOUS FAILSAFE: Start fetch in background, don't block navigation
        getDoc(doc(db, 'handoff_tokens', refId)).then((tokenDoc) => {
          if (tokenDoc.exists()) {
            const data = tokenDoc.data();
            // 2. THE MEMORY LOCK (TATTOO TO HARD DRIVE)
            if (data.uniqueId) localStorage.setItem('uniqueId', data.uniqueId);
            if (data.totalamountBridge) localStorage.setItem('totalamountBridge', data.totalamountBridge);
            if (data.servicesOrdered) localStorage.setItem('servicesOrdered', data.servicesOrdered);
            if (data.firstName) localStorage.setItem('name[first]', data.firstName);
            if (data.lastName) localStorage.setItem('name[last]', data.lastName);
            if (data.email) localStorage.setItem('email', data.email);
            if (data.phone) localStorage.setItem('phone', data.phone);
            if (data.storecode) localStorage.setItem('storecode', data.storecode);
            if (data.customernotes) localStorage.setItem('customernotes', data.customernotes);
            
            // Tattoo completed - update active session and form data in background
            const firstName = data.firstName || '';
            const lastName = data.lastName || '';
            const email = data.email || '';
            const phone = data.phone || '';

            setIntakeData(prev => ({
              ...prev,
              firstName: firstName || prev.firstName,
              lastName: lastName || prev.lastName,
              email: email || prev.email,
              phone: phone || prev.phone,
            }));

            setSession(prev => prev ? {
              ...prev,
              name: `${firstName} ${lastName}`.trim() || prev.name,
              email: email || prev.email,
              phoneNumber: phone || prev.phoneNumber,
              totalAmount: data.totalamountBridge || prev.totalAmount,
              uniqueId: data.uniqueId || prev.uniqueId,
              servicesOrdered: data.servicesOrdered || prev.servicesOrdered,
              customernotes: data.customernotes || prev.customernotes,
            } : prev);
          }
        }).catch((err) => {
          if (err.message && err.message.includes('permission')) {
            console.error('CRITICAL: Firebase Rules are BLOCKING the Photo Bridge. Check handoff_tokens collection permissions.', err);
          } else {
            console.error('Firebase Bridge retrieval fail - falling back to memory:', err);
          }
        });
      }

      if (params.get('status') === 'success') {
        setSuccessOrderId(params.get('orderId'));
        
        const name = params.get('name') || '';
        const totalAmount = params.get('totalAmount') || params.get('totalamount') || '';
        const uniqueId = params.get('uniqueId') || params.get('reportid1') || params.get('reportId1') || params.get('reportID1') || localStorage.getItem('uniqueId') || `M2M-${Math.floor(100000 + Math.random() * 900000)}`;
        const email = params.get('email') || '';
        const phoneNumber = params.get('phoneNumber') || params.get('phone') || '';
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

        setPhotos([]); 
        setMode('success');
        return;
      }

      // --- WHITELIST PROTOCOL: Explicitly facilitate these specific keys from URL or LocalStorage ---
      const urlUniqueId = params.get('uniqueId') || params.get('uniqueid') || params.get('uniqueidBridge') || params.get('reportid1');
      const urlTotalAmount = params.get('totalamountBridge') || params.get('totalAmount') || params.get('amount');
      const urlServices = params.get('servicesOrdered') || params.get('services');
      const urlFirstName = params.get('name[first]') || params.get('firstName') || params.get('first_name');
      const urlLastName = params.get('name[last]') || params.get('lastName') || params.get('last_name');

      // Recovery Logic from LocalStorage (Memory Lock Alignment)
      const { fName: urlFName, lName: urlLName } = splitName(params.get('name') || '');
      const uniqueid = urlUniqueId || localStorage.getItem('uniqueId') || '';
      const totalamountBridge = urlTotalAmount || localStorage.getItem('totalamountBridge') || '';
      const servicesOrdered = urlServices || localStorage.getItem('servicesOrdered') || '';
      const firstName = urlFirstName || urlFName || localStorage.getItem('name[first]') || '';
      const lastName = urlLastName || urlLName || localStorage.getItem('name[last]') || '';
      const email = params.get('email') || params.get('emailAddress') || localStorage.getItem('email') || '';
      const phone = params.get('phone') || params.get('phoneNumber') || params.get('cell') || localStorage.getItem('phone') || '';
      const customernotes = params.get('customernotes') || params.get('notes') || localStorage.getItem('customernotes') || '';
      const storecode = (params.get('storecode') || params.get('store_code') || localStorage.getItem('storecode') || 'DEFAULT').toLowerCase().trim();

      // --- IMMEDIATE PERSISTENCE (THE TATTOO) ---
      if (uniqueid) localStorage.setItem('uniqueId', uniqueid);
      if (totalamountBridge) localStorage.setItem('totalamountBridge', totalamountBridge);
      if (servicesOrdered) localStorage.setItem('servicesOrdered', servicesOrdered);
      if (firstName) localStorage.setItem('name[first]', firstName);
      if (lastName) localStorage.setItem('name[last]', lastName);
      if (email) localStorage.setItem('email', email);
      if (phone) localStorage.setItem('phone', phone);
      if (customernotes) localStorage.setItem('customernotes', customernotes);
      if (storecode) localStorage.setItem('storecode', storecode);

      const finalUniqueId = uniqueid || `M2M-${Math.floor(100000 + Math.random() * 900000)}`;

      setIntakeData({
          firstName,
          lastName,
          email,
          phone,
      });
      
      const sessionData: SessionData = {
        sessionid: (params.get('sessionid') || generateSessionId()).toUpperCase().trim(),
        name: `${firstName} ${lastName}`.trim(),
        email,
        phoneNumber: phone,
        totalAmount: totalamountBridge,
        uniqueId: finalUniqueId,
        storecode,
        date: params.get('date') || new Date().toISOString().split('T')[0],
        servicesOrdered,
        totalamountBridge,
        customernotes,
      };
      setSession(sessionData);

      // --- THE NAVIGATION REPAIR ---
      // Always start on Intake (Page 1) so users can see/verify their data
      setMode('intake');

      signInAnonymously(auth).catch(() => {});
    };

    initialize();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
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

      // --- PERSISTENCE: Push updated details to localStorage (Sync with Memory Lock) ---
      localStorage.setItem('name[first]', intakeData.firstName);
      localStorage.setItem('name[last]', intakeData.lastName);
      localStorage.setItem('email', intakeData.email);
      localStorage.setItem('phone', intakeData.phone);
      
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

  const handleSubmit = async () => {
    if (!session || isSyncing || isUploading) return;
    
    setIsUploading(true);
    try {
      // --- DATA HITCHHIKER LOCK (RAW STRING REDIRECT) ---
      // Force fetch strictly from localStorage to guarantee persistence through camera reset
      const id = localStorage.getItem('uniqueId') || '';
      const total = localStorage.getItem('totalamountBridge') || '';
      const services = localStorage.getItem('servicesOrdered') || '';

      const target = 'https://form.jotform.com/261217230124139?totalamountBridge=' + total + 
        '&servicesOrdered=' + encodeURIComponent('ID: ' + id + ' | ' + services) + 
        '&name[first]=&name[last]=&email=';

      console.log('HARD-PASS REDIRECT TRIGGERED:', target);
      window.location.replace(target);
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
    const displayId = (params.get('uniqueId') || params.get('reportid1') || params.get('reportId1') || params.get('reportID1') || session?.uniqueId || '000000').replace('M2M-', '');
    const displayName = params.get('name') || session?.name || 'Customer Verified';
    const displayTotal = params.get('totalAmount') || params.get('totalamount') || session?.totalAmount || '0.00';
    
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
    <div className="min-h-screen w-full bg-[#000000] text-white font-sans flex flex-col relative pb-0">
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

      <main className="flex-1 flex flex-col bg-black">
        {/* Viewfinder - Doubled presence */}
        <div className="relative w-full aspect-[1/1] bg-black overflow-hidden z-10">
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
            className="w-full h-full object-cover grayscale-0 opacity-100"
          />
          <div className="absolute inset-0 border-b border-white/20" />
          
          {/* Overlay Status */}
          <div className="absolute top-6 left-6">
             <button 
               onClick={() => setMode('intake')}
               className="p-3 bg-[#00FF88]/5 backdrop-blur-xl border border-[#00FF88]/20 rounded-full text-[#00FF88] active:scale-90 transition-all"
             >
               <ArrowLeft className="w-6 h-6" />
             </button>
          </div>

          <div className="absolute top-6 right-6">
            <div className="bg-[#00FF88]/5 backdrop-blur-xl border border-[#00FF88]/20 px-4 py-2 rounded-full flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${allPhotosReady ? 'bg-[#00FF88] animate-pulse' : 'bg-white/10'}`} />
              <span className="text-[12px] font-black text-[#00FF88] uppercase tracking-[0.2em] font-mono">
                {allPhotosReady ? 'READY' : 'CAPTURING'}
              </span>
            </div>
          </div>
        </div>

        {/* The Capture Hub - Structural Redesign */}
        <div className="flex-1 flex flex-col items-center px-4 pt-4 pb-4 overflow-y-auto gap-4">
          
          {/* 1. Primary Centered Section */}
          <div className="grid grid-cols-2 gap-16 w-full max-w-[260px]">
            {/* IMAGE 1 - Primary Requirement */}
            <CaptureWindow 
              label="IMAGE 1" 
              required={!hasItem} 
              photo={itemPhotos[0]} 
              onCapture={() => handleCapture('item')} 
              onRemove={() => removePhoto(itemPhotos[0].id)}
              icon={Package}
            />
            {/* BARCODE #'s - Primary Requirement */}
            <CaptureWindow 
              label="BARCODE #'s" 
              required={!hasLabel} 
              photo={labelPhoto} 
              onCapture={() => handleCapture('label')} 
              onRemove={() => removePhoto(labelPhoto!.id)}
              icon={Barcode}
            />
          </div>

          {/* 2. The Anchor Pill - Integrated Flow */}
          <div className="w-full flex justify-center py-2">
            <button
              onClick={handleSubmit}
              disabled={!allPhotosReady}
              className={`
                w-full max-w-[300px] h-14 text-[15px] font-black uppercase tracking-[0.3em] transition-all relative overflow-hidden rounded-full pointer-events-auto
                ${allPhotosReady 
                  ? 'bg-[#00FF88] text-black shadow-[0_10px_40px_rgba(0,255,136,0.3)] hover:scale-[1.02] active:scale-[0.98]' 
                  : 'bg-[#111111] text-white/20 cursor-not-allowed border border-[#00FF88]/20'}
              `}
            >
              <div className="relative z-10 flex items-center justify-center gap-2">
                {(isSyncing || isUploading) ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Syncing...</span>
                  </>
                ) : (
                  <>
                    <span>Complete & Proceed</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </div>
            </button>
          </div>

          {/* 3. Secondary Row (The Basement) */}
          <div className="grid grid-cols-3 gap-3 w-full max-w-[320px]">
            {[1, 2, 3].map((idx) => (
              <CaptureWindow 
                key={`extra-${idx}`}
                label={`ADD ${idx}`}
                photo={itemPhotos[idx]}
                onCapture={() => handleCapture('item')}
                onRemove={() => removePhoto(itemPhotos[idx].id)}
                icon={Plus}
                small
              />
            ))}
          </div>
        </div>

        {/* Global Footer Watermark - Locked Position */}
        <div className="bg-black border-t border-[#00FF88]/30 px-8 py-1.5 flex justify-between items-center z-50">
          <span className="text-[11px] font-black text-[#00FF88] uppercase tracking-[0.2em] font-mono">
            {session?.storecode || 'OFFLINE'}
          </span>
          <span className="text-[11px] font-black text-[#00FF88] uppercase tracking-[0.2em] font-mono">
            {new Date().toLocaleDateString()}
          </span>
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
