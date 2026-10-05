import puppeteer from 'puppeteer-core';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: "new"
  });
  const page = await browser.newPage();
  
  // The local app. Let's try navigating to the project page or just the index page to see what renders.
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle0' });
  
  const content = await page.content();
  
  // Try to see if it redirects or renders a project list
  console.log("Page URL:", page.url());
  
  // We can try to load the specific project URL.
  // We might not know the exact route, maybe `/project-98cf855a-7974-4a7b-ab4b-5de8e2f89668`?
  await page.goto('http://127.0.0.1:4173/project-98cf855a-7974-4a7b-ab4b-5de8e2f89668', { waitUntil: 'networkidle0' });
  
  let videoDetails = null;
  try {
    await page.waitForSelector('video', { timeout: 5000 });
    videoDetails = await page.evaluate(async () => {
      const video = document.querySelector('video');
      const results = [];
      if (!video) return null;
      
      const checkTime = async (time) => {
        video.currentTime = time;
        await new Promise(r => {
          const onSeeked = () => { video.removeEventListener('seeked', onSeeked); r(); };
          video.addEventListener('seeked', onSeeked);
        });
        return {
          time: video.currentTime,
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          duration: video.duration
        };
      };
      
      results.push(await checkTime(5));
      results.push(await checkTime(30));
      results.push(await checkTime(58));
      
      return results;
    });
  } catch (e) {
    console.error("Error finding or playing video:", e);
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log("Page text:", bodyText.substring(0, 500));
  }
  
  console.log("Video Playback Results:", JSON.stringify(videoDetails, null, 2));
  await browser.close();
})();
