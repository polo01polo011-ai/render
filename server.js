const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// تفعيل إضافة التخفي لمنع كشف البوتات
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

// سجل كل الطلبات الواردة
app.use((req, res, next) => {
    console.log(`📝 ${req.method} ${req.path} - IP: ${req.ip}`);
    next();
});

const PORT = process.env.PORT || 3000;

// ============================================
// صفحة رئيسية للتأكد من أن السيرفر شغال
// ============================================
app.get('/', (req, res) => {
    res.json({
        status: '🟢 السيرفر شغال بكفاءة',
        version: '1.0.0',
        endpoints: {
            '/scrape': {
                method: 'POST',
                description: 'كشط محتوى أي رابط',
                body: { url: 'https://example.com' }
            },
            '/health': {
                method: 'GET',
                description: 'فحص صحة السيرفر'
            }
        },
        timestamp: new Date().toISOString()
    });
});

// ============================================
// مسار فحص الصحة (للـ Render)
// ============================================
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    });
});

// ============================================
// مسار GET للتجربة (يعطي تعليمات)
// ============================================
app.get('/scrape', (req, res) => {
    res.status(200).json({
        success: false,
        error: '⚠️ يرجى استخدام POST وليس GET',
        instructions: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: {
                url: 'https://example.com'
            }
        },
        example: {
            curl: 'curl -X POST https://render-9ujf.onrender.com/scrape -H "Content-Type: application/json" -d \'{"url":"https://example.com"}\'',
            javascript: 'fetch("https://render-9ujf.onrender.com/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://example.com" }) })'
        }
    });
});

// ============================================
// المسار الرئيسي للكشط (يدعم POST فقط)
// ============================================
app.post('/scrape', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({
            success: false,
            error: "❌ الرابط مطلوب! أضف 'url' في جسم الطلب",
            example: { url: "https://example.com" }
        });
    }

    // تنظيف الرابط
    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = 'https://' + cleanUrl;
    }

    let browser;
    try {
        console.log(`🚀 جاري كشط الرابط: ${cleanUrl}`);
        
        // تشغيل المتصفح بإعدادات متوافقة مع Render
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--single-process',
                '--disable-extensions'
            ]
        });

        const page = await browser.newPage();

        // تعيين User Agent حقيقي
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // إعدادات إضافية للتمويه
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        });

        // الذهاب للرابط
        await page.goto(cleanUrl, { 
            waitUntil: 'networkidle2', 
            timeout: 30000 
        });

        // انتظار إضافي للـ AJAX
        await new Promise(resolve => setTimeout(resolve, 3000));

        // جلب محتوى الصفحة
        const htmlContent = await page.content();
        
        // محاولة استخراج الأسماء مباشرة
        const extractedNames = await page.evaluate(() => {
            const names = [];
            const text = document.body.innerText;
            
            // البحث عن أسماء عربية
            const arabicRegex = /[\u0600-\u06FF]{3,}(?:\s+[\u0600-\u06FF]{3,}){0,3}/g;
            let match;
            while ((match = arabicRegex.exec(text)) !== null) {
                const name = match[0].trim();
                if (name.length > 2 && name.length < 30) {
                    names.push(name);
                }
            }
            
            // البحث عن أسماء في عناصر محددة
            const elements = document.querySelectorAll('a, span, div, li, td, th');
            elements.forEach(el => {
                const text = el.textContent.trim();
                if (text.length > 2 && text.length < 30 && /[\u0600-\u06FF]/.test(text)) {
                    if (!names.includes(text)) {
                        names.push(text);
                    }
                }
            });
            
            return [...new Set(names)].slice(0, 50);
        });

        console.log(`✅ تم كشط الصفحة بنجاح، حجم HTML: ${htmlContent.length} حرف`);
        console.log(`📊 تم استخراج ${extractedNames.length} اسم مباشرة`);
        
        await browser.close();

        // إرسال النتيجة
        return res.json({
            success: true,
            html: htmlContent,
            extracted_names: extractedNames,
            url: cleanUrl,
            scraped_at: new Date().toISOString(),
            stats: {
                html_length: htmlContent.length,
                names_found: extractedNames.length
            }
        });

    } catch (error) {
        console.error("❌ خطأ في الكشط:", error.message);
        if (browser) await browser.close();
        
        return res.status(500).json({
            success: false,
            error: error.message,
            url: cleanUrl
        });
    }
});

// ============================================
// معالجة المسارات غير الموجودة (404)
// ============================================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: "❌ المسار غير موجود",
        available_endpoints: ['/', '/health', '/scrape (POST)']
    });
});

// ============================================
// تشغيل السيرفر
// ============================================
app.listen(PORT, () => {
    console.log(`🚀 السيرفر شغال على المنفذ ${PORT}`);
    console.log(`📡 رابط السيرفر: http://localhost:${PORT}`);
    console.log(`🔍 مسار الكشط: POST http://localhost:${PORT}/scrape`);
});

// معالجة إغلاق السيرفر بشكل آمن
process.on('SIGTERM', () => {
    console.log('🛑 جاري إيقاف السيرفر...');
    process.exit(0);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ خطأ غير متوقع:', err);
});
