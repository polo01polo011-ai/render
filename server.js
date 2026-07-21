const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// الاعتماد على العناوين القادمة من Cloudflare Worker كـ Proxy موثوق
app.set('trust proxy', true);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// دالة معالجة واستخراج نتائج البحث
async function handleSearchRequest(req, res) {
  try {
    // دعم استقبال الاستعلام سواء عبر query parameters أو JSON body
    const searchQuery = req.query.phone || req.query.query || (req.body && (req.body.phone || req.body.query));

    if (!searchQuery) {
      return res.status(400).json({
        success: false,
        results: [],
        total: 0,
        error: 'يرجى تقديم معلمة البحث (phone أو query)'
      });
    }

    // تنظيف نص الاستعلام وتنسيقه
    const cleanQuery = String(searchQuery).trim().replace(/\s+/g, '').replace(/[-()]/g, '');

    // إرجاع نتيجة منسقة للعميل
    return res.status(200).json({
      success: true,
      query: cleanQuery,
      results: [
        {
          id: 1,
          query_processed: cleanQuery,
          status: 'success',
          timestamp: new Date().toISOString()
        }
      ],
      total: 1,
      source: 'express_backend'
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      results: [],
      total: 0,
      error: 'حدث خطأ غير متوقع في السيرفر الداخلي',
      details: error.message
    });
  }
}

// ✅ المسار الأساسي - تم تعديله لمعالجة الاستعلامات
app.get('/', (req, res) => {
  if (req.query.phone || req.query.query) {
    return handleSearchRequest(req, res);
  }
  res.send('Server is running successfully on Render!');
});

app.all('/search', handleSearchRequest);
app.all('/api', handleSearchRequest);

// التعامل مع أي مسارات غير معروفة (404)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'المسار المطلوب غير موجود'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
