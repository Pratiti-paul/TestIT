# Official Microsoft Playwright image matching Playwright version 1.64.1 on Ubuntu Noble
FROM mcr.microsoft.com/playwright:v1.64.1-noble

# Set working directory
WORKDIR /app

# Configure Node environment
ENV NODE_ENV=production

# Point Playwright to the pre-installed browsers in /ms-playwright and avoid redundant downloads
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy dependency specifications first to leverage Docker layer caching
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Default port fallback (Render dynamically injects process.env.PORT at runtime)
ENV PORT=5001
EXPOSE 5001

# Start the application using npm start
CMD ["npm", "start"]

