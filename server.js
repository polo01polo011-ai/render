const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// =============================================
// ROUTES
// =============================================

// Root route
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: '✅ Phone Lookup API is running!',
    endpoints: {
      search: {
        method: 'GET',
        url: '/api/search?query=771234567',
        description: 'Search for phone number'
      },
      health: {
        method: 'GET',
        url: '/health',
        description: 'Health check'
      }
    },
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.query;
    
    console.log(`🔍 Searching for: ${query}`);

    if (!query) {
      return res.status(200).json({
        success: false,
        error: '❌ الرجاء إدخال رقم الهاتف',
        example: '/api/search?query=771234567'
      });
    }

    // Clean phone number
    let cleanPhone = query.trim().replace(/\s+/g, '').replace(/[-()]/g, '');
    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
    else if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    else if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
    if (cleanPhone.startsWith('967')) cleanPhone = cleanPhone.substring(3);

    // Detect provider
    let provider = 'رقم دولي';
    if (/^(77|78)[0-9]{7}$/.test(cleanPhone)) provider = 'يمن موبايل';
    else if (/^(73)[0-9]{7}$/.test(cleanPhone)) provider = 'YOU';
    else if (/^(71)[0-9]{7}$/.test(cleanPhone)) provider = 'سبأفون';
    else if (/^(70)[0-9]{7}$/.test(cleanPhone)) provider = 'واي';

    // Try to fetch real data
    let results = [];
    let source = 'test';
    let success = false;

    // Try Firecrawl if API key exists
    const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || 'fc-b11dd2129b814b3a91ed3903d3b1c8fd';
    
    if (FIRECRAWL_API_KEY) {
      try {
        const phoneForScraping = '+967' + cleanPhone;
        const targetUrl = `https://b.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(phoneForScraping)}`;
        
        console.log('🔥 Trying Firecrawl...');
        
        const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: targetUrl,
            formats: ['json', 'html'],
            waitFor: 3000,
            timeout: 15000
          })
        });

        if (response.ok) {
          const data = await response.json();
          console.log('✅ Firecrawl response received');
          
          // Extract names from response
          if (data.data && data.data.json && data.data.json.result) {
            const text = data.data.json.result;
            const nameMatches = text.match(/[\u0600-\u06FF]{3,}(?:\s+[\u0600-\u06FF]{3,}){0,2}/g);
            
            if (nameMatches) {
              const uniqueNames = [...new Set(nameMatches)]
                .filter(name => name.length > 2 && !name.includes('ل'));
              
              results = uniqueNames.slice(0, 10).map(name => ({
                name: name.trim(),
                phone: cleanPhone,
                provider: provider,
                source: 'Firecrawl',
                formattedDate: new Date().toLocaleDateString('ar-EG')
              }));
              
              success = true;
              source = 'firecrawl';
              console.log(`✅ Found ${results.length} names`);
            }
          }
        }
      } catch (e) {
        console.error('❌ Firecrawl error:', e.message);
      }
    }

    // If no results, return mock data for testing
    if (!success || results.length === 0) {
      results = [
        {
          name: 'اسم تجريبي 1',
          phone: cleanPhone,
          provider: provider,
          source: 'اختبار',
          formattedDate: new Date().toLocaleDateString('ar-EG')
        },
        {
          name: 'اسم تجريبي 2',
          phone: cleanPhone,
          provider: provider,
          source: 'اختبار',
          formattedDate: new Date().toLocaleDateString('ar-EG')
        }
      ];
      source = 'mock';
    }

    // Return response
    return res.status(200).json({
      success: true,
      results: results,
      total: results.length,
      source: source,
      phone: query,
      provider: provider,
      cached_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST endpoint
app.post('/api/search', async (req, res) => {
  const query = req.body.query;
  req.query.query = query;
  return app._router.handle(req, res);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: '❌ المسار غير موجود',
    available_endpoints: [
      '/',
      '/health',
      '/api/search?query=771234567'
    ]
  });
});

// =============================================
// START SERVER
// =============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`🔍 Test: /api/search?query=771234567`);
  console.log(`🏥 Health: /health`);
});
