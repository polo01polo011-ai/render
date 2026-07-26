const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());
app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Phone Lookup API is running',
        endpoints: {
            search: '/api/search?query=771234567',
            health: '/health'
        }
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Search endpoint
app.get('/api/search', (req, res) => {
    const query = req.query.query;
    
    if (!query) {
        return res.status(400).json({
            success: false,
            error: 'Please provide a phone number',
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

    // Mock response for testing
    res.json({
        success: true,
        phone: query,
        cleaned: cleanPhone,
        provider: provider,
        results: [
            {
                name: 'اختبار',
                phone: cleanPhone,
                provider: provider,
                source: 'test',
                formattedDate: new Date().toLocaleDateString('ar-EG')
            }
        ],
        total: 1,
        message: 'API is working!'
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔍 Test: https://render-9ujf.onrender.com/api/search?query=771234567`);
});
