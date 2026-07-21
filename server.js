const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // أضف هذا السطر

const app = express();
const PORT = process.env.PORT || 10000;

app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function handleSearchRequest(req, res) {
  try {
    const searchQuery = req.query.phone || req.query.query || (req.body && (req.body.phone || req.body.query));

    if (!searchQuery) {
      return res.status(400).json({
        success: false,
        error: 'يرجى تقديم معلمة البحث (phone أو query)'
      });
    }

    // تنظيف الرقم
    let cleanQuery = String(searchQuery).trim().replace(/\s+/g, '').replace(/[-()]/g, '');
    if (cleanQuery.startsWith('967')) {
      cleanQuery = cleanQuery.substring(3);
    }
    if (cleanQuery.startsWith('+967')) {
      cleanQuery = cleanQuery.substring(4);
    }

    // التأكد من أن الرقم مكون من 9 أرقام
    if (!/^\d{9}$/.test(cleanQuery)) {
      return res.status(400).json({
        success: false,
        error: 'الرقم يجب أن يكون 9 أرقام (بدون 967+)'
      });
    }

    // الاتصال بـ API النابكس
    const targetUrl = `https://3.nabx.net/wp-admin/admin-ajax.php?action=alosh_search&phone=%2B967${cleanQuery}`;
    
    const response = await fetch(targetUrl);
    
    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }
    
    const data = await response.json();

    // إعادة النتيجة مع معلومات إضافية
    return res.status(200).json({
      ...data,
      proxy_source: 'render_backend',
      query_processed: cleanQuery,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'حدث خطأ في جلب البيانات',
      details: error.message
    });
  }
}

// المسارات
app.route('/')
  .get((req, res) => {
    if (req.query.phone || req.query.query) {
      return handleSearchRequest(req, res);
    }
    res.send('🚀 Server is running successfully on Render!');
  })
  .post(handleSearchRequest);

app.all('/search', handleSearchRequest);
app.all('/api', handleSearchRequest);

// معالجة 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'المسار المطلوب غير موجود'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
