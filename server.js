const express = require('express');
const cors = require('cors');

const fetch = globalThis.fetch || require('node-fetch');

const app = express();
const PORT = process.env.PORT || 10000;

app.set('trust proxy', true);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// دالة جلب نتائج البحث
async function handleSearch(req, res) {
  try {
    // دعم استقبال الرقم سواء كان اسم البرامتر phone أو query
    let phoneParam = req.query.phone || req.query.query || (req.body && (req.body.phone || req.body.query));

    if (!phoneParam) {
      if (req.path === '/' && Object.keys(req.query).length === 0) {
        return res.send('Server is running successfully on Render!');
      }
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'يرجى إرسال رقم الهاتف في الطلب'
      });
    }

    // تنظيف الرقم وتنسيقه
    let cleanPhone = String(phoneParam).trim().replace(/\s+/g, '').replace(/[-()]/g, '');
    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
    else if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    else if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);

    if (cleanPhone.startsWith('967')) cleanPhone = cleanPhone.substring(3);

    const provider = detectProvider(cleanPhone);
    const scrapePhone = provider !== 'رقم دولي' ? '+967' + cleanPhone : '+' + cleanPhone;

    // بناء رابط الطلب المباشر للمصدر عبر GET
    const targetUrl = `https://3.nabx.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}`;

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml,application/json,*/*;q=0.8',
        'Accept-Language': 'ar,en;q=0.9',
        'Referer': 'https://3.nabx.net/'
      }
    });

    if (!response.ok) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: `خطأ في الاتصال بالمصدر: ${response.status}`
      });
    }

    const contentType = response.headers.get('content-type') || '';
    let names = [];

    if (contentType.includes('application/json')) {
      const jsonResponse = await response.json();
      if (Array.isArray(jsonResponse)) {
        names = jsonResponse.map(item => item.name || item).filter(Boolean);
      } else if (jsonResponse.data && Array.isArray(jsonResponse.data)) {
        names = jsonResponse.data.map(item => item.name || item).filter(Boolean);
      }
    } else {
      const textResponse = await response.text();
      names = extractNamesFromResponse(textResponse);
    }

    if (names.length === 0) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'لم يتم العثور على نتائج'
      });
    }

    const displayPhone = provider !== 'رقم دولي' && !cleanPhone.startsWith('0') ? '0' + cleanPhone : cleanPhone;

    const results = names.map(name => ({
      name: name,
      phone: displayPhone,
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
    return res.status(500).json({
      success: false,
      results: [],
      total: 0,
      error: e.message
    });
  }
}

// استقبال الطلبات على جميع المسارات الممكنة
app.get('/', handleSearch);
app.get('/search', handleSearch);
app.get('/api', handleSearch);

app.use((req, res) => {
  handleSearch(req, res);
});

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
    if (name.length > 2 && !names.includes(name)) names.push(name);
  }

  return [...new Set(names)].slice(0, 50);
}

function cleanExtractedName(name) {
  return name
    .replace(/\{.*?\}/g, '')
    .replace(/[\\{}{}\[\]"':\-_,\/]/g, ' ')
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
  console.log(`Server running on port ${PORT}`);
});
