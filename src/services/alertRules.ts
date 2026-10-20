import { DetectedItem, AlertPriority, Language } from '../types';

const OBJECT_MAP: Record<string, { en: string; hi: string; hinglish: string; priority: AlertPriority }> = {
  person: { en: 'Person', hi: 'व्यक्ति', hinglish: 'Person', priority: 'high' },
  car: { en: 'Car', hi: 'कार', hinglish: 'Car', priority: 'high' },
  motorcycle: { en: 'Motorcycle', hi: 'मोटरसाइकिल', hinglish: 'Bike', priority: 'high' },
  bus: { en: 'Bus', hi: 'बस', hinglish: 'Bus', priority: 'high' },
  truck: { en: 'Truck', hi: 'ट्रक', hinglish: 'Truck', priority: 'high' },
  bicycle: { en: 'Bicycle', hi: 'साइकिल', hinglish: 'Cycle', priority: 'high' },
  dog: { en: 'Dog', hi: 'कुत्ता', hinglish: 'Dog', priority: 'high' },
  cat: { en: 'Cat', hi: 'बिल्ली', hinglish: 'Cat', priority: 'medium' },
  chair: { en: 'Chair', hi: 'कुर्सी', hinglish: 'Chair', priority: 'medium' },
  couch: { en: 'Sofa', hi: 'सोफ़ा', hinglish: 'Sofa', priority: 'medium' },
  bench: { en: 'Bench', hi: 'बेंच', hinglish: 'Bench', priority: 'medium' },
  'potted plant': { en: 'Plant pot', hi: 'पौधे का गमला', hinglish: 'Plant pot', priority: 'medium' },
  'dining table': { en: 'Table', hi: 'मेज', hinglish: 'Table', priority: 'medium' },
  bed: { en: 'Bed', hi: 'बिस्तर', hinglish: 'Bed', priority: 'medium' },
  door: { en: 'Door', hi: 'दरवाज़ा', hinglish: 'Door', priority: 'medium' },
  backpack: { en: 'Backpack', hi: 'बैग', hinglish: 'Bag', priority: 'low' },
  umbrella: { en: 'Umbrella', hi: 'छाता', hinglish: 'Umbrella', priority: 'low' },
  suitcase: { en: 'Suitcase', hi: 'सूटकेस', hinglish: 'Suitcase', priority: 'medium' },
  bottle: { en: 'Bottle', hi: 'बोतल', hinglish: 'Bottle', priority: 'low' },
  cell_phone: { en: 'Phone', hi: 'फ़ोन', hinglish: 'Phone', priority: 'low' },
  'cell phone': { en: 'Phone', hi: 'फ़ोन', hinglish: 'Phone', priority: 'low' },
  laptop: { en: 'Laptop', hi: 'लैपटॉप', hinglish: 'Laptop', priority: 'low' },
  tv: { en: 'TV', hi: 'टीवी', hinglish: 'TV', priority: 'low' },
  monitor: { en: 'Monitor', hi: 'मॉनिटर', hinglish: 'Monitor', priority: 'low' },
  book: { en: 'Book', hi: 'किताब', hinglish: 'Book', priority: 'low' },
  clock: { en: 'Clock', hi: 'घड़ी', hinglish: 'Clock', priority: 'low' },
  'fire hydrant': { en: 'Fire hydrant', hi: 'फ़ायर हाइड्रेंट', hinglish: 'Fire hydrant', priority: 'medium' },
  'stop sign': { en: 'Stop sign', hi: 'स्टॉप साइन', hinglish: 'Stop sign', priority: 'medium' },
  'traffic light': { en: 'Traffic light', hi: 'ट्रैफ़िक लाइट', hinglish: 'Traffic light', priority: 'high' },
};

export function getObjectMeta(categoryName: string): { en: string; hi: string; hinglish: string; priority: AlertPriority } {
  const key = categoryName.toLowerCase().trim();
  if (OBJECT_MAP[key]) return OBJECT_MAP[key];
  const en = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
  return { en, hi: en, hinglish: en, priority: 'medium' };
}

export type FramePosition = 'left' | 'centre' | 'right';

export function getFramePosition(boxOriginX: number, boxWidth: number, frameWidth: number): FramePosition {
  if (frameWidth <= 0) return 'centre';
  const centerX = boxOriginX + boxWidth / 2;
  const ratio = centerX / frameWidth;
  if (ratio < 0.33) return 'left';
  if (ratio > 0.66) return 'right';
  return 'centre';
}

export type ProximityEstimate = 'near' | 'medium' | 'far' | 'unknown';

export function estimateProximity(boxHeight: number, frameHeight: number): ProximityEstimate {
  if (frameHeight <= 0 || boxHeight <= 0) return 'unknown';
  const ratio = boxHeight / frameHeight;
  if (ratio > 0.45) return 'near';
  if (ratio > 0.18) return 'medium';
  return 'far';
}

const PROXIMITY_LABELS: Record<ProximityEstimate, { en: string; hi: string; hinglish: string }> = {
  near: { en: 'nearby (approx.)', hi: 'पास (अनुमानित)', hinglish: 'paas mein (approx.)' },
  medium: { en: 'at medium distance (approx.)', hi: 'मध्यम दूरी पर (अनुमानित)', hinglish: 'medium distance (approx.)' },
  far: { en: 'far away (approx.)', hi: 'दूर (अनुमानित)', hinglish: 'door (approx.)' },
  unknown: { en: '', hi: '', hinglish: '' },
};

const POSITION_LABELS_EN: Record<FramePosition, string> = {
  left: 'on the left side',
  centre: 'ahead',
  right: 'on the right side',
};

const POSITION_LABELS_HI: Record<FramePosition, string> = {
  left: 'बाईं तरफ़',
  centre: 'सामने',
  right: 'दाईं तरफ़',
};

const POSITION_LABELS_HINGLISH: Record<FramePosition, string> = {
  left: 'left side mein',
  centre: 'saamne',
  right: 'right side mein',
};

export function buildAlertPhrase(
  item: DetectedItem,
  lang: Language,
  frameWidth: number,
  frameHeight: number,
): { speechText: string; displayText: string; priority: AlertPriority } {
  const pos = getFramePosition(item.box.originX, item.box.width, frameWidth);
  const prox = estimateProximity(item.box.height, frameHeight);
  const isHighPriority = item.priority === 'high';
  const isNear = prox === 'near';
  const conf = Math.round(item.score * 100);

  if (lang === 'hi') {
    const label = item.labelHi;
    const posLabel = POSITION_LABELS_HI[pos];
    const proxLabel = PROXIMITY_LABELS[prox].hi;
    const displayText = isHighPriority
      ? `संभावित बाधा: ${label} — ${posLabel}${proxLabel ? `, ${proxLabel}` : ''} (${conf}%)`
      : `दिखाई दिया: ${label} — ${posLabel}${proxLabel ? `, ${proxLabel}` : ''} (${conf}%)`;

    let speechText = '';
    if (isHighPriority) {
      if (isNear) {
        speechText = `सावधान, ${posLabel} एक ${label} बहुत पास है, कृपया संभलकर चलें।`;
      } else {
        speechText = `ध्यान दें, ${posLabel} एक ${label} है।`;
      }
    } else {
      speechText = `${posLabel} एक ${label} दिखाई दे रही है।`;
    }
    return { speechText, displayText, priority: item.priority };
  }

  if (lang === 'hinglish') {
    const label = item.labelHinglish || item.labelEn;
    const posLabel = POSITION_LABELS_HINGLISH[pos];
    const proxLabel = PROXIMITY_LABELS[prox].hinglish;
    const displayText = isHighPriority
      ? `Possible obstacle: ${label} — ${posLabel}${proxLabel ? `, ${proxLabel}` : ''} (${conf}%)`
      : `Detected: ${label} — ${posLabel}${proxLabel ? `, ${proxLabel}` : ''} (${conf}%)`;

    let speechText = '';
    if (isHighPriority) {
      if (isNear) {
        if (pos === 'centre') {
          speechText = `Dhyan dein, saamne ek ${label} kaafi paas hai, thoda sambhal kar.`;
        } else {
          speechText = `Dhyan dein, ${posLabel} ek ${label} kaafi paas hai.`;
        }
      } else {
        if (pos === 'centre') {
          speechText = `Aage ek ${label} dikh raha hai, thoda dhyan se.`;
        } else {
          speechText = `${posLabel} ek ${label} hai, thoda dhyan se.`;
        }
      }
    } else {
      if (pos === 'centre') {
        speechText = `Saamne ek ${label} dikh rahi hai.`;
      } else {
        speechText = `${posLabel} ek ${label} dikh rahi hai.`;
      }
    }
    return { speechText, displayText, priority: item.priority };
  }

  // English
  const label = item.labelEn;
  const posLabel = POSITION_LABELS_EN[pos];
  const proxLabel = PROXIMITY_LABELS[prox].en;
  const displayText = isHighPriority
    ? `Possible obstacle: ${label} ${posLabel}${proxLabel ? `, ${proxLabel}` : ''} (${conf}% conf)`
    : `Detected: ${label} ${posLabel}${proxLabel ? `, ${proxLabel}` : ''} (${conf}% conf)`;

  let speechText = '';
  if (isHighPriority) {
    if (isNear) {
      speechText = `Caution, ${label} close ${posLabel}. Please be careful.`;
    } else {
      speechText = `Attention, there is a ${label} ${posLabel}.`;
    }
  } else {
    speechText = `${label} detected ${posLabel}.`;
  }
  return { speechText, displayText, priority: item.priority };
}

export function getSystemMessage(key: string, lang: Language): string {
  const MESSAGES: Record<string, Record<Language, string>> = {
    startAssistance: {
      en: 'Assistance active. Detecting objects.',
      hi: 'सहायता सक्रिय है। वस्तुओं की पहचान शुरू हो रही है।',
      hinglish: 'Assistance start ho gaya hai. Camera objects scan kar raha hai.',
    },
    stopAssistance: {
      en: 'Assistance stopped.',
      hi: 'सहायता रोक दी गई है।',
      hinglish: 'Assistance stop kar diya gaya hai.',
    },
    loadingModel: {
      en: 'Loading vision model, please wait.',
      hi: 'मॉडल लोड हो रहा है, कृपया प्रतीक्षा करें।',
      hinglish: 'AI vision model load ho raha hai, please wait kijiye.',
    },
    openingCamera: {
      en: 'Requesting camera access.',
      hi: 'कैमरा शुरू हो रहा है।',
      hinglish: 'Camera start ho raha hai.',
    },
    noDetections: {
      en: 'The path ahead appears clear of major obstacles for now.',
      hi: 'दृश्य में कोई प्रमुख बाधा नहीं दिख रही है।',
      hinglish: 'Aage ka path abhi clear lag raha hai, koi major obstacle nahi hai.',
    },
    testVoiceSample: {
      en: 'Hello! Pathora AI voice alerts are working clearly at this speed.',
      hi: 'नमस्ते! पैथोरा एआई की आवाज़ इस गति पर बिल्कुल स्पष्ट काम कर रही है।',
      hinglish: 'Namaste! Pathora AI ki voice alerts is speed par bilkul clearly work kar rahi hain.',
    },
    voiceEnabled: {
      en: 'Voice alerts enabled.',
      hi: 'आवाज़ चालू है।',
      hinglish: 'Voice alerts on ho gaye hain.',
    },
    voiceDisabled: {
      en: 'Voice alerts muted.',
      hi: 'आवाज़ बंद कर दी गई है।',
      hinglish: 'Voice alerts mute ho gaye hain.',
    },
    noPreviousAlert: {
      en: 'No previous alert to repeat.',
      hi: 'दोहराने के लिए कोई पिछला अलर्ट नहीं है।',
      hinglish: 'Repeat karne ke liye koi alert nahi hai.',
    },
    cameraError: {
      en: 'Error starting camera or AI model.',
      hi: 'कैमरा या मॉडल लोड करने में त्रुटि।',
      hinglish: 'Camera ya AI model start karne mein error aaya hai.',
    },
    langChangedEn: {
      en: 'English language selected.',
      hi: 'English language selected.',
      hinglish: 'English language selected.',
    },
    langChangedHi: {
      en: 'हिंदी भाषा चुनी गई।',
      hi: 'हिंदी भाषा चुनी गई।',
      hinglish: 'हिंदी भाषा चुनी गई।',
    },
    langChangedHinglish: {
      en: 'Hinglish language select ho gayi hai.',
      hi: 'Hinglish language select ho gayi hai.',
      hinglish: 'Hinglish language select ho gayi hai.',
    },
  };
  return MESSAGES[key]?.[lang] || MESSAGES[key]?.en || '';
}

export function alertRulesSelfCheck(): boolean {
  const meta = getObjectMeta('person');
  if (meta.priority !== 'high' || meta.en !== 'Person') return false;

  const phraseEn = buildAlertPhrase({
    id: '1', category: 'person',
    labelEn: meta.en, labelHi: meta.hi, labelHinglish: meta.hinglish,
    score: 0.85, priority: meta.priority,
    box: { originX: 100, originY: 0, width: 100, height: 200 },
  }, 'en', 640, 480);
  if (!phraseEn.speechText.includes('Caution') && !phraseEn.speechText.includes('Attention')) return false;

  const phraseHinglish = buildAlertPhrase({
    id: '1', category: 'person',
    labelEn: meta.en, labelHi: meta.hi, labelHinglish: meta.hinglish,
    score: 0.85, priority: meta.priority,
    box: { originX: 100, originY: 0, width: 100, height: 200 },
  }, 'hinglish', 640, 480);
  if (!phraseHinglish.speechText.includes('person') && !phraseHinglish.speechText.includes('Person')) return false;

  const left = getFramePosition(10, 50, 640);
  const right = getFramePosition(500, 50, 640);
  if (left !== 'left' || right !== 'right') return false;
  return true;
}
