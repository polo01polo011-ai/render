const express = require('express');
const cors = require('cors');

// استخدام fetch المدمج في Node.js 18+ وفي حال عدم وجوده يتم استدعاء node-fetch
const fetch = globalThis.fetch || require('node-fetch');

const app = express();
const PORT = process.env.PORT || 10000;

// الثقة بالـ Proxy لتحديد الـ IP الصحيح عبر Cloudflare Worker
app.set('trust proxy', true);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ذاكرة بسيطة جداً لمؤشر الـ Rate Limit لمنع الإغراق الإجباري
const rateLimitMap = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitMap.entries()) {
    if (now - value > 10000) rateLimitMap.delete(key);
  }
}, 60000);

// المسار الرئيسي لاستقبال طلبات البحث على جميع المسارات الممكنة: /, /lookup, /v1/lookup
app.all(['/', '/lookup', '/v1/lookup'], async (req, res) => {
  try {
    let query = req.query.query || (req.body && req.body.query);

    // إذا لم يرسل المستخدم بحث وكانت الزيارة للجذر بدون استعلام
    if (!query && req.path === '/') {
      return res.send('Server is running successfully on Render!');
    }

    if (!query) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'البحث فارغ'
      });
    }

    // --- 1. نظام الحماية IP (حد أدنى ثانيتين بين الطلبات) ---
    const userIP = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || 'anonymous';
    const currentTime = Math.floor(Date.now() / 1000);
    const lastRequestTime = rateLimitMap.get(userIP) || 0;

    if (currentTime - lastRequestTime < 2) {
      const secondsLeft = 2 - (currentTime - lastRequestTime);
      return res.status(429).json({
        success: false,
        results: [],
        total: 0,
        error: 'مهلاً! الرجاء الانتظار',
        message: `⏳ خطأ حماية: يرجى الانتظار ${secondsLeft} ثواني بين عمليات البحث المتتالية.`
      });
    }

    rateLimitMap.set(userIP, currentTime);

    // --- 2. تنظيف وتجهيز رقم الهاتف ---
    let cleanPhone = String(query).trim().replace(/\s+/g, '').replace(/[-()]/g, '');
    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
    else if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    else if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);

    if (cleanPhone.startsWith('967')) cleanPhone = cleanPhone.substring(3);

    const provider = detectProvider(cleanPhone);
    let databasePhone = cleanPhone;
    if (provider !== 'رقم دولي' && !databasePhone.startsWith('0')) {
      databasePhone = '0' + databasePhone;
    }

    const scrapePhone = provider !== 'رقم دولي' ? '+967' + cleanPhone : '+' + cleanPhone;

    // --- 3. الجلب المباشر المباشر والحي من الموقع ---
    let names = [];
    let success = false;
    let lastError = null;

    try {
      const targetUrl = `https://3.nabx.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}`;
      console.log(`📡 جلب مباشر وحي من المصدر: ${targetUrl}`);

      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'ar,en;q=0.9',
          'Referer': 'https://3.nabx.net/'
        }
      });

      if (response.ok) {
        const htmlContent = await response.text();

        if (htmlContent && htmlContent.length >= 50) {
          const extractedNames = extractNamesFromResponse(htmlContent);

          if (extractedNames.length > 0) {
            names = extractedNames;
            success = true;
          } else {
            const alternativeNames = extractNamesAlternative(htmlContent);
            if (alternativeNames.length > 0) {
              names = alternativeNames;
              success = true;
            } else {
              lastError = 'لم يتم العثور على أي أسماء مطابقة في محتوى الصفحة';
            }
          }
        } else {
          lastError = 'استجابة فارغة من المصدر';
        }
      } else {
        lastError = `خطأ في الاتصال بالموقع المصدر: ${response.status}`;
      }
    } catch (e) {
      lastError = `فشل الاتصال بالموقع المصدر: ${e.message}`;
      console.error('❌ ' + lastError);
    }

    if (!success || names.length === 0) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: lastError || 'لم يتم العثور على نتائج',
        debug: { phone: scrapePhone, provider }
      });
    }

    // --- 4. إرجاع النتائج مباشرة ---
    const results = names.map(name => ({
      name: name,
      phone: databasePhone,
      source: 'الموقع المباشر',
      provider: provider,
      formattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    return res.status(200).json({
      success: true,
      results,
      total: results.length,
      source: 'direct_scrape'
    });

  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json({
      success: false,
      results: [],
      total: 0,
      error: e.message
    });
  }
});

// --- الدوال المساعدة لمسح وتحليل نص HTML المجلوب من الموقع ---

function extractNamesFromResponse(html) {
  const names = [];
  const numberedPattern = /(\d+)\s*[-–—]\s*([^\d\n<]+)/g;
  let match;
  while ((match = numberedPattern.exec(html)) !== null) {
    let name = cleanExtractedName(match[2]);
    if (name.length > 2 && !names.includes(name)) names.push(name);
  }

  const arabicNamePattern = /[\u0600-\u06FF]{3,}(?:\s+[\u0600-\u06FF]{3,}){0,3}/g;
  let arabicMatch;
  while ((arabicMatch = arabicNamePattern.exec(html)) !== null) {
    let name = cleanExtractedName(arabicMatch[0]);
    if (name.length > 2 && !names.includes(name) && !name.includes('ل')) names.push(name);
  }

  const listPattern = /<li[^>]*>([^<]+)<\/li>|<div[^>]*>([^<]+)<\/div>/g;
  let listMatch;
  while ((listMatch = listPattern.exec(html)) !== null) {
    let name = cleanExtractedName(listMatch[1] || listMatch[2] || '');
    if (name.length > 2 && !names.includes(name) && /[\u0600-\u06FF]/.test(name)) names.push(name);
  }

  return [...new Set(names)].slice(0, 100);
}

function extractNamesAlternative(html) {
  const names = [];
  const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const arabicPattern = /[\u0600-\u06FF]{3,}(?:\s+[\u0600-\u06FF]{3,}){0,2}/g;
  let match;
  while ((match = arabicPattern.exec(textContent)) !== null) {
    let name = cleanExtractedName(match[0]);
    if (name.length > 2 && !names.includes(name) && !name.includes('ل') && name.length < 30) names.push(name);
  }

  const keywords = ['اسم', 'الاسم', 'name', 'user', 'contact', 'صاحب', 'مالك'];
  for (const keyword of keywords) {
    const regex = new RegExp(`${keyword}[\\s:]*([^\\n<,]+)`, 'gi');
    let match;
    while ((match = regex.exec(textContent)) !== null) {
      let name = cleanExtractedName(match[1]);
      if (name.length > 2 && !names.includes(name) && /[\u0600-\u06FF]/.test(name)) names.push(name);
    }
  }

  return [...new Set(names)].slice(0, 50);
}

function cleanExtractedName(name) {
  return name
    .replace(/\{.*?\}/g, '')
    .replace(/[\\{}{}\[\]"':\-_,\/]/g, ' ')
    .replace(/\b(info|country|n|null|undefined|الرقم|اسم|search|phone|نتائج|البحث|للرقم|الشهرة|السجلات|المكتشفة|الأكثر|شيوعاً|اليمن|من|هذا|هذه|كان|مع|عن|على|الى|حتى|بين|أو|و|ف|في|إلى|على|عن|من|إلى|عند|ب|ك|ل|لل|و|ثم|حتى|لكن|ولا|أو|ثم|حيث|بين|عندما|ذلك|هذه|هذا|التي|الذي|الذين|اللاتي|اللواتي|منذ|خلال|بسبب|دون|بينما|حيثما|كلما|متى|أين|كيف|إذا|لن|لم|ما|لا|ليس|سوف|قد|ربما|لعل|ليت|لابد|لعل|لكي|كي|حتّى|حتى)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectProvider(cleanPhone) {
  if (/^(77|78)[0-9]{7}$/.test(cleanPhone)) return 'يمن موبايل';
  if (/^(73)[0-9]{7}$/.test(cleanPhone)) return 'YOU';
  if (/^(71)[0-9]{7}$/.test(cleanPhone)) return 'سبأفون';
  if (/^(70)[0-9]{7}$/.test(cleanPhone)) return 'واي';
  return 'رقم دولي';
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
