class EventEmitter {
  constructor() {
    this.listeners = {};
  }

  on(event, listener) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((listener) => listener(data));
    }
  }
}

class VideoTranslationManager {
  constructor() {
    this.translations = [];
    this.vttContent = "";
    this.senderId = "";
    this.eventEmit = new EventEmitter();
    this.eventEmit.on("vttContentLoaded", () =>
      this.sendToThirdPartyTranslate(this.vttContent)
    );
    this.eventEmit.on("hasTranslateResponse", () =>
      this.loadVTTTranslations(this.vttContent)
    );
    this.eventEmit.on("contentParsed", this.init.bind(this));

    const onMessageListener = (request, sender, sendResponse) => {
      if (request.vttContent || request.action === "updateVTT") {
        this.vttContent = request.vttContent;
        this.senderId = sender.id;
        this.eventEmit.emit("vttContentLoaded");
        chrome.runtime.onMessage.removeListener(onMessageListener);
      }
    };

    chrome.runtime.onMessage.addListener(onMessageListener);
  }

  // Function to load VTT translations from content
  async loadVTTTranslations(vttContent) {
    this.parseVTT(vttContent);
    console.log("Parsed Translations:", this.translations);
    this.eventEmit.emit("contentParsed");
  }

  // Function to parse VTT content
  parseVTT(vttText) {
    const lines = vttText.split("\n");
    let currentTranslation = null;
    this.translations = [];

    const timeRegex = /(\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}\.\d{3})/;

    lines.forEach((line) => {
      line = line.trim();
      const timeMatch = line.match(timeRegex);
      if (timeMatch) {
        if (currentTranslation) {
          this.translations.push(currentTranslation);
        }
        currentTranslation = {
          start: timeMatch[1],
          end: timeMatch[2],
          text: "",
        };
      } else if (line && currentTranslation) {
        currentTranslation.text += line + " ";
      }
    });

    if (currentTranslation) {
      this.translations.push(currentTranslation);
    }

    this.translations = this.translations.map((translation) => ({
      start: translation.start,
      end: translation.end,
      text: translation.text.trim(),
    }));

    return this.translations;
  }

  // Function to split VTT content by half the total character count, ensuring no broken time stamps
  segmentVTTContent(vttContent, maxLength = 2000) {
    const blocks = vttContent.split("\n\n");
    const segments = [];
    let currentSegment = "";
    let currentCharCount = 0;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const blockLength = block.length + 2; // +2 for the double newline

      if (currentCharCount + blockLength > maxLength) {
        // Ensure the segment starts with a valid timestamp
        if (/^\d{2}:\d{2}:\d{2}/.test(block)) {
          segments.push(currentSegment.trim());
          currentSegment = block;
          currentCharCount = blockLength;
        } else {
          currentSegment += "\n\n" + block;
          currentCharCount += blockLength;
        }
      } else {
        currentSegment += (currentSegment ? "\n\n" : "") + block;
        currentCharCount += blockLength;
      }
    }

    if (currentSegment) {
      segments.push(currentSegment.trim());
    }

    return segments;
  }

  // Function to send segments to OpenAI API
  async sendToThirdPartyTranslate(vttContent) {
    // const apiKey =
    //   "REMOVED";
    const url = "https://api.openai.com/v1/chat/completions";
    const segments = this.segmentVTTContent(vttContent);

    // Function to process segments
    const processSegment = async (segment) => {
      // const messages = [
      //   {
      //     role: "system",
      //     content:
      //       "Your are a Translator, please translate this script to Vietnamese",
      //   },
      //   {
      //     role: "user",
      //     content: `translate to vietnamese and keep timeline format ${segment}`,
      //   },
      // ];
      try {
        const response = await fetch("http://localhost:5000/translate", {
          method: "POST",
          body: JSON.stringify({
            q: segment,
            source: "auto",
            target: "vi",
            format: "text",
            alternatives: 3,
            api_key: "",
          }),
          headers: { "Content-Type": "application/json" },
        });

        const data = await response.json();
        console.log("OpenAI API response:", data);
        return data.translatedText;
      } catch (error) {
        console.error("Error sending to OpenAI API:", error);
        return null;
      }
    };

    const contentTranslated = await Promise.all([
      segments.forEach((segment) => processSegment(segment)),
    ]);
    if (contentTranslated) {
      this.vttContent = contentTranslated.join("");
      this.eventEmit.emit("hasTranslateResponse");
      console.log("------EMIT EVENT WHEN HAS TRANSLATE RESPONSE------");
      console.log("Translated Content:", this.vttContent);
      console.log("------EMIT EVENT WHEN HAS TRANSLATE RESPONSE------");
    } else {
      console.error("Failed to process segments.");
    }
  }

  // Create and load modal
  loadModalIntoDom(parentNode) {
    const div = document.createElement("div");
    div.id = "udemy-translation";
    div.className = "udemy-translator-popup";
    div.style.position = "absolute";
    div.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    div.style.color = "white";
    div.style.padding = "10px";
    div.style.borderRadius = "5px";
    div.style.left = "50%";
    div.style.bottom = "0";
    div.style.transform = "translateX(-50%)";
    div.style.maxWidth = "90%";
    div.style.wordBreak = "break-word";
    parentNode.append(div);
  }

  // Show translation popup
  showTranslationPopup(video) {
    const existingPopup = document.getElementById("udemy-translation");
    if (existingPopup) {
      const updatePopup = () => {
        const currentTime = video.currentTime;
        const translation = this.translations.find((t) => {
          const start = this.parseTime(t.start);
          const end = this.parseTime(t.end);
          return currentTime >= start && currentTime <= end;
        });
        existingPopup.innerText = translation ? translation.text.trim() : "";
      };

      video.addEventListener("timeupdate", updatePopup);
      video.addEventListener("ended", () => existingPopup.remove());
    }
  }

  // Parse time from VTT format to seconds
  parseTime(timeStr) {
    const [minutes, seconds] = timeStr.split(":").map(parseFloat);
    return minutes * 60 + seconds;
  }

  // Wait for video element in DOM
  waitForVideoElement(selector) {
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const videoElement = document.querySelector(selector);
        if (videoElement) {
          observer.disconnect();
          resolve(videoElement);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Wait for transcript element
  waitTranscriptElement(selector) {
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const transcriptElement = document.querySelector(selector);
        if (transcriptElement) {
          observer.disconnect();
          console.log("Transcript Element found:", transcriptElement);
          resolve(transcriptElement);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Initialize video translation
  async init() {
    try {
      const transcriptElement = await this.waitTranscriptElement(
        'div[class^="video-player--container--"]'
      );
      this.loadModalIntoDom(transcriptElement);

      const video = await this.waitForVideoElement("video");
      this.showTranslationPopup(video);
    } catch (error) {
      console.error("Error during initialization:", error);
    }
  }
}

// Instantiate and initialize the manager
const videoTranslationManager = new VideoTranslationManager();
