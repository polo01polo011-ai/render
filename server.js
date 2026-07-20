const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// تفعيل إضافة التخفي لمنع كشف البوتات
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post('/scrape', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ success: false, error: "Missing 'url' parameter" });
    }

    let browser;
    try {
        console.log(`🚀 البدء بطلب الرابط: ${url}`);
        
        // تشغيل المتصفح بإعدادات متوافقة مع بيئة Render لتقليل استهلاك الذاكرة
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();

        // تعيين User Agent حقيقي وإضافي للتمويه
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // الذهاب للرابط والانتظار حتى انتهاء شبكة الاتصال (أو حتى ظهور البيانات)
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // ننتظر 3 ثواني إضافية لضمان عمل الـ AJAX وظهور الأسماء بالموقع
        await new Promise(resolve => setTimeout(resolve, 3000));

        // جلب محتوى الصفحة بالكامل بعد فك التشفير وعرض الأسماء
        const htmlContent = await page.content();
        
        console.log(`✅ تم جلب البيانات بنجاح، طول الـ HTML هو: ${htmlContent.length}`);
        
        await browser.close();

        // إرسال النص إلى Cloudflare Worker ليقوم بدوره باستخراج الأسماء بذكائه المعتاد
        return res.json({ success: true, html: htmlContent });

    } catch (error) {
        console.error("❌ حدث خطأ أثناء الكشط:", error.message);
        if (browser) await browser.close();
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Scraper server running on port ${PORT}`);
});