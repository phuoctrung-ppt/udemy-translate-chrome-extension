// Listen for installation or update of the extension
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed or updated");
  // You can perform any initialization tasks here
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "someAction") {
    // Handle the action
    console.log("Received message:", message);
    // Perform some task based on the message
    sendResponse({ result: "Action completed" });
  }
});

chrome.action.onClicked.addListener((tab) => {
  console.log("Extension icon clicked");
  // Execute content script in the current tab
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["js/content.js"],
  });
});

const processedUrls = new Set();

chrome.webRequest.onCompleted.addListener(
  async function (details) {
    if (details.url.includes(".vtt") && !processedUrls.has(details.url)) {
      fetchVTTContent(details.url);
    }
  },
  { urls: ["<all_urls>"] }
);

// Listen for changes in the URL of the active tab
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    console.log("URL changed to:", changeInfo.url);
    // Check if the new URL contains a video
    if (changeInfo.url.includes("video")) {
      // Fetch the VTT content if applicable
      fetchVTTContent(changeInfo.url,true);
    }
  }
});

// Function to fetch VTT content
async function fetchVTTContent(url, isUpdateVTT = false) {
  try {
    const response = await fetch(url);
    let vttContent = await response.text();
    if (vttContent.startsWith("WEBVTT")) {
      vttContent = vttContent.replace("WEBVTT", "").trim(); // Remove the prefix and trim whitespace
    }
    console.log('VTT Content:', vttContent.length);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          vttContent: vttContent,
          ...(isUpdateVTT && { action: "updateVTT" }),
        });
      }
    });
    processedUrls.add(url);
    console.log("--------------------Publishing message------------------");
    console.log(vttContent);
    console.log("--------------------Publishing message------------------");
  } catch (error) {
    console.error("Error fetching VTT content:", error);
  }
}
