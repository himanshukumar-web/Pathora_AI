import { DetectedItem, AlertPriority, Language } from '../types';

// Map common COCO class names to English and Hindi labels + obstacle priority
const OBJECT_MAP: Record<string, { en: string; hi: string; priority: AlertPriority }> = {
  person: { en: 'Person', hi: 'व्यक्ति', priority: 'high' },
  car: { en: 'Car', hi: 'कार', priority: 'high' },
  motorcycle: { en: 'Motorcycle', hi: 'मोटरसाइकिल', priority: 'high' },
  bus: { en: 'Bus', hi: 'बस', priority: 'high' },
  truck: { en: 'Truck', hi: 'ट्रक', priority: 'high' },
  bicycle: { en: 'Bicycle', hi: 'साइकिल', priority: 'high' },
  dog: { en: 'Dog', hi: 'कुत्ता', priority: 'high' },
  cat: { en: 'Cat', hi: 'बिल्ली', priority: 'medium' },
  chair: { en: 'Chair', hi: 'कुर्सी', priority: 'medium' },
  couch: { en: 'Sofa', hi: 'सोफ़ा', priority: 'medium' },
  bench: { en: 'Bench', hi: 'बेंच', priority: 'medium' },
  'potted plant': { en: 'Plant pot', hi: 'पौधे का गमला', priority: 'medium' },
  'dining table': { en: 'Table', hi: 'मेज', priority: 'medium' },
  bed: { en: 'Bed', hi: 'बिस्तर', priority: 'medium' },
  door: { en: 'Door', hi: 'दरवाज़ा', priority: 'medium' },
  backpack: { en: 'Backpack', hi: 'बैग', priority: 'low' },
  umbrella: { en: 'Umbrella', hi: 'छाता', priority: 'low' },
  suitcase: { en: 'Suitcase', hi: 'सूटकेस', priority: 'medium' },
  bottle: { en: 'Bottle', hi: 'बोतल', priority: 'low' },
  cell_phone: { en: 'Phone', hi: 'फ़ोन', priority: 'low' },
  'cell phone': { en: 'Phone', hi: 'फ़ोन', priority: 'low' },
  laptop: { en: 'Laptop', hi: 'लैपटॉप', priority: 'low' }
};

export function getObjectMeta(categoryName: string): { en: string; hi: string; priority: AlertPriority } {
  const key = categoryName.toLowerCase().trim();
  if (OBJECT_MAP[key]) {
    return OBJECT_MAP[key];
  }
  // shortcut: capitalize unknown COCO label, default to medium priority
  const en = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
  return { en, hi: en, priority: 'medium' };
}

export function buildAlertPhrase(
  item: DetectedItem,
  lang: Language
): { speechText: string; displayText: string } {
  const isHighPriority = item.priority === 'high';

  if (lang === 'hi') {
    const label = item.labelHi;
    const displayText = isHighPriority 
      ? `संभावित बाधा: ${label} (सटीकता ${Math.round(item.score * 100)}%)` 
      : `दिखाई दिया: ${label} (सटीकता ${Math.round(item.score * 100)}%)`;
    const speechText = isHighPriority 
      ? `ध्यान दें, सामने ${label}` 
      : `${label}`;
    return { speechText, displayText };
  }

  const label = item.labelEn;
  const displayText = isHighPriority 
    ? `Possible obstacle: ${label} (${Math.round(item.score * 100)}% conf)` 
    : `Detected: ${label} (${Math.round(item.score * 100)}% conf)`;
  const speechText = isHighPriority 
    ? `Attention, ${label} ahead` 
    : `${label} detected`;
  return { speechText, displayText };
}

// Self-check for Ponytail verification rule
export function alertRulesSelfCheck(): boolean {
  const meta = getObjectMeta('person');
  if (meta.priority !== 'high' || meta.en !== 'Person') return false;
  const phrase = buildAlertPhrase({
    id: '1',
    category: 'person',
    labelEn: meta.en,
    labelHi: meta.hi,
    score: 0.85,
    box: { originX: 0, originY: 0, width: 10, height: 10 },
    priority: meta.priority
  }, 'en');
  return phrase.speechText.includes('Attention');
}
