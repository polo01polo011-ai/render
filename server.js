const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 10000;

// الثقة بالـ Proxy لمفتاح الـ IP الصحيح عبر Cloudflare
app.set('trust proxy', true);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ذاكرة مؤقتة بسيطة للـ Rate Limit وبديل لـ Cache
const rateLimitMap = new Map();
const memoryCache = new Map();

// تنظيف الذاكرة المؤقتة كل ساعة لمنع استهلاك الذاكرة
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitMap.entries()) {
    if (now - value > 10000) rateLimitMap.delete(key);
  }
  for (const [key, value] of memoryCache.entries()) {
    if (value.expiry < now) memoryCache.delete(key);
  }
}, 3600000);

// المسار الرئيسي لاستقبال طلبات البحث
app.all('/v1/lookup', async (req, res) => {
  try {
    // --- 1. نظام حماية يعتمد على الـ IP ---
    const userIP = req.headers['cf-connecting-ip'] || req.ip || 'anonymous';
    const currentTime = Math.floor(Date.now() / 1000);
    const lastRequestTime = rateLimitMap.get(userIP) || 0;

    if (currentTime - lastRequestTime < 3) {
      const secondsLeft = 3 - (currentTime - lastRequestTime);
      return res.status(429).json({
        success: false,
        results: [],
        total: 0,
        error: 'مهلاً! الرجاء الانتظار',
        message: `⏳ خطأ حماية: يرجى الانتظار ${secondsLeft} ثواني بين عمليات البحث المتتالية.`
      });
    }

    rateLimitMap.set(userIP, currentTime);

    // --- 2. جلب وتجهيز نص البحث (Query) ---
    let query = req.method === 'GET' ? req.query.query : req.body.query;

    if (!query) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'البحث فارغ'
      });
    }

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

    // --- المستوى 1: الكاش المحلي بالسيرفر ---
    const cacheKey = `phone:${databasePhone}`;
    const cachedData = memoryCache.get(cacheKey);
    if (cachedData && cachedData.expiry > Date.now()) {
      return res.status(200).json(cachedData.data);
    }

    // --- المستوى 2: قراءة من Supabase ---
    const supabaseUrl = process.env.SUPABASE_URL || "https://qfcsaiyuyxhibidrrmha.supabase.co";
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (supabaseAnonKey) {
      try {
        console.log(`🔎 استعلام قراءة من جدول numbers للرقم: ${databasePhone}`);

        const dbResponse = await fetch(
          `${supabaseUrl}/rest/v1/numbers?phone=eq.${databasePhone}&select=*`,
          {
            headers: {
              'apikey': supabaseAnonKey,
              'Authorization': `Bearer ${supabaseAnonKey}`,
            }
          }
        );

        if (dbResponse.ok) {
          const existingRecords = await dbResponse.json();
          if (existingRecords && existingRecords.length > 0) {
            console.log(`🎯 تم العثور على الرقم مسبقاً في جدول numbers!`);

            const results = existingRecords.map(rec => {
              const name = rec.name || rec.contact_name || rec.full_name || rec.username || 'اسم غير معروف';
              const phone = rec.phone || rec.phone_number || databasePhone;
              const src = rec.source || rec.data_source || 'قاعدة البيانات المسبقة';
              const prov = rec.provider || rec.telecom || provider;
              const date = rec.created_at || rec.added_at || new Date().toISOString();

              return {
                name: name,
                phone: phone,
                source: src,
                provider: prov,
                formattedDate: new Date(date).toLocaleDateString('ar-EG')
              };
            });

            const finalResponse = {
              success: true,
              results,
              total: results.length,
              source: 'database_cache',
              cached_at: new Date().toISOString()
            };

            // تخزين في الكاش المحلي لمدة 3 أيام
            memoryCache.set(cacheKey, { data: finalResponse, expiry: Date.now() + 259200000 });

            return res.status(200).json(finalResponse);
          }
        }
      } catch (dbErr) {
        console.error('❌ خطأ أثناء قراءة جدول numbers:', dbErr);
      }
    }

    // --- المستوى 3: جلب البيانات مباشرة من الموقع ---
    let names = [];
    let success = false;
    let lastError = null;
    let source = '';

    try {
      const targetUrl = `https://3.nabx.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}`;
      console.log(`📡 جلب مباشر من المصدر: ${targetUrl}`);

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
        console.log(`📄 تم جلب المحتوى بطول: ${htmlContent.length} حرف`);

        if (htmlContent && htmlContent.length >= 50) {
          const extractedNames = extractNamesFromResponse(htmlContent);

          if (extractedNames.length > 0) {
            names = extractedNames;
            success = true;
            source = 'direct_scrape';
            console.log(`✅ تم استخراج ${names.length} اسم`);
          } else {
            const alternativeNames = extractNamesAlternative(htmlContent);
            if (alternativeNames.length > 0) {
              names = alternativeNames;
              success = true;
              source = 'direct_scrape_alternative';
              console.log(`✅ تم استخراج ${names.length} اسم (طريقة بديلة)`);
            } else {
              lastError = 'لم يتم العثور على أي أسماء مطابقة في محتوى الصفحة';
              console.log('⚠️ ' + lastError);
            }
          }
        } else {
          lastError = 'استجابة فارغة من المصدر';
          console.log('⚠️ ' + lastError);
        }
      } else {
        lastError = `خطأ في الاتصال: ${response.status}`;
        console.log(`❌ ${lastError}`);
      }
    } catch (e) {
      lastError = `فشل الاتصال: ${e.message}`;
      console.error('❌ ' + lastError);
    }

    // التجربة عبر Firecrawl في حال الفشل
    if (!success || names.length === 0) {
      console.log('🔄 محاولة الجلب عبر Firecrawl...');
      const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

      if (FIRECRAWL_API_KEY) {
        try {
          const targetUrl = `https://3.nabx.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}`;

          const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: targetUrl,
              formats: ['html'],
              waitFor: 3000
            })
          });

          if (response.ok) {
            const data = await response.json();
            const htmlContent = data.data?.html || data.html || data.content || '';

            if (htmlContent && htmlContent.length >= 50) {
              const extractedNames = extractNamesFromResponse(htmlContent);
              if (extractedNames.length > 0) {
                names = extractedNames;
                success = true;
                source = 'firecrawl';
                console.log(`✅ تم استخراج ${names.length} اسم عبر Firecrawl`);
              } else {
                const alternativeNames = extractNamesAlternative(htmlContent);
                if (alternativeNames.length > 0) {
                  names = alternativeNames;
                  success = true;
                  source = 'firecrawl_alternative';
                  console.log(`✅ تم استخراج ${names.length} اسم عبر Firecrawl (طريقة بديلة)`);
                }
              }
            }
          }
        } catch (e) {
          console.error('❌ خطأ في Firecrawl:', e);
        }
      }
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

    // تجهيز النتيجة الحالية
    const results = names.map(name => ({
      name: name,
      phone: databasePhone,
      source: 'سجل الموقع (جديد)',
      provider: provider,
      formattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    const finalResponse = {
      success: true,
      results,
      total: results.length,
      source: source,
      cached_at: new Date().toISOString()
    };

    // حفظ في الكاش لمدة 3 أيام
    memoryCache.set(cacheKey, { data: finalResponse, expiry: Date.now() + 259200000 });

    return res.status(200).json(finalResponse);

  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json({
      success: false,
      results: [],
      total: 0,
      error: e.message,
      stack: e.stack
    });
  }
});

// اختبار حالة السيرفر (Health Check)
app.get('/', (req, res) => {
  res.send('Server is running successfully on Render!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// --- الدوال المساعدة ---
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
