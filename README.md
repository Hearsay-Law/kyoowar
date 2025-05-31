# Kyoowar: the QR Pattern Hunter 🕵️‍♂️💨

Just a fun little experiment I built to explore QR codes, image processing, and multi-threading with Node.js.

## What's it do?

The QR Pattern Hunter does the following:

1.  **Random URL & QR Generation:** It continuously generates random website URLs.
2.  **QR Code Creation:** For each URL, it generates a corresponding QR code image.
3.  **Pixel Art Matching:** It then scans these freshly made QR codes to see if a specific, small pixel art pattern (that you provide in the templates directory and specify in config.js) is hidden somewhere within the QR code's design.
4.  **Speedy Searching (Multi-threaded):** To make the hunt faster, it uses multiple worker threads to process QR codes in parallel, taking advantage of multi-core CPUs.
5.  **Web UI:** Has a simple web interface where you can:
    - See the status of the search (how many QRs checked, how many matches found).
    - View the matches when they're discovered, along with the URL that generated them.
    - Start and stop the hunting process.

## Why?

A different approach to finding a domain name you want.

## The Tech Stack (Quick Glance)

- Node.js
- Express.js (for the simple web server)
- Socket.IO (for real-time communication with the browser)
- Jimp (or similar, for image processing on the main thread and in workers)
- Worker Threads (for concurrency)

## How to use:

1.  **Provide a Pattern:** You'll need a small `.png` image of the pixel art you want to search for. Place it in the `templates/` directory. These need to be black and white (and I do mean absolute black and white)
2.  **Configure:** Check out `config.js` to adjust things like the URL template or the pattern filename.
3.  **Install Dependencies:** `npm install`
4.  **Run:** `node server.js`
5.  Open your browser to `http://localhost:3000` (or whatever port is configured).
6.  Click "Start Searching" and watch the hunt begin!

---

Thanks for checking out my little project!
