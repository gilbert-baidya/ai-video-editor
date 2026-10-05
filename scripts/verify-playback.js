const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: "new"
  });
  const page = await browser.newPage();
  
  // The local app might not auto-route correctly, or maybe it does. Let's try the index first.
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle0' });
  
  // Wait for the video element or an element that indicates the project has loaded
  // Or maybe we need to navigate directly to the project?
  // Let's see if we can find a video element
  let videoDetails = null;
  try {
    await page.waitForSelector('video', { timeout: 10000 });
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
  }
  
  console.log("Video Playback Results:", JSON.stringify(videoDetails, null, 2));
  await browser.close();
})();
