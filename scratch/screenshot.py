import os
from playwright.sync_api import sync_playwright

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        url = "http://localhost:8000/index.html?autodeploy=1"
        print(f"Navigating to {url}...")
        page.goto(url)
        print("Page loaded, waiting for autodeploy and battle screen...")
        page.wait_for_timeout(10000) # wait 10 seconds
        screenshot_path = os.path.join(r"C:\Users\aware.梨花のPC\.gemini\antigravity\brain\453b90c1-f9b0-40b7-823c-ba32a81e1617", "game_screenshot.png")
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to: {screenshot_path}")
        browser.close()

if __name__ == "__main__":
    main()
