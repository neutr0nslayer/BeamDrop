// BeamDrop Frontend Engine (File Transfer + Link Shortener)
(function() {
  'use strict';

  // State
  let config = {
    port: 3055,
    maxFileSizeMB: 150,
    fileTtlMinutes: 60,
    publicUrl: window.location.origin
  };

  let activeTab = 'files';
  let stagedFile = null;
  let activeTransfer = null;
  let activeLink = null;
  let countdownInterval = null;
  let linkCountdownInterval = null;

  // Navigation & Hero DOM
  const navTabFiles = document.getElementById('nav-tab-files');
  const navTabLinks = document.getElementById('nav-tab-links');
  const tabPanelFiles = document.getElementById('tab-panel-files');
  const tabPanelLinks = document.getElementById('tab-panel-links');
  const heroTitle = document.getElementById('hero-title');
  const heroSubtitle = document.getElementById('hero-subtitle');
  const featureTtlText = document.getElementById('feature-ttl-text');
  const featureLimitText = document.getElementById('feature-limit-text');
  const aliasPrefixText = document.getElementById('alias-prefix-text');

  // File Transfer DOM Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const browseBtn = document.getElementById('browse-btn');
  const fileStagedCard = document.getElementById('file-staged-card');
  const stagedFileName = document.getElementById('staged-file-name');
  const stagedFileSize = document.getElementById('staged-file-size');
  const stagedFileType = document.getElementById('staged-file-type');
  const btnCancelFile = document.getElementById('btn-cancel-file');
  const btnStartUpload = document.getElementById('btn-start-upload');
  
  const progressContainer = document.getElementById('progress-container');
  const progressFill = document.getElementById('progress-fill');
  const progressPercentage = document.getElementById('progress-percentage');
  const progressStatusText = document.getElementById('progress-status-text');

  const uploadView = document.getElementById('upload-view');
  const resultView = document.getElementById('result-view');
  
  const qrImage = document.getElementById('qr-image');
  const resultFilename = document.getElementById('result-filename');
  const resultFilesize = document.getElementById('result-filesize');
  const liveCountdown = document.getElementById('live-countdown');
  const copyLinkInput = document.getElementById('copy-link-input');
  const btnCopyLink = document.getElementById('btn-copy-link');
  const btnDirectDownload = document.getElementById('btn-direct-download');
  const btnSaveQr = document.getElementById('btn-save-qr');
  const btnSendAnother = document.getElementById('btn-send-another');
  const btnBurnFile = document.getElementById('btn-burn-file');

  // Link Shortener DOM Elements
  const shortenerFormView = document.getElementById('shortener-form-view');
  const shortenerForm = document.getElementById('shortener-form');
  const longUrlInput = document.getElementById('long-url-input');
  const btnPasteUrl = document.getElementById('btn-paste-url');
  const customAliasInput = document.getElementById('custom-alias-input');
  const linkTtlSelect = document.getElementById('link-ttl-select');
  const btnShortenSubmit = document.getElementById('btn-shorten-submit');

  const linkResultView = document.getElementById('link-result-view');
  const linkQrImage = document.getElementById('link-qr-image');
  const linkLiveCountdown = document.getElementById('link-live-countdown');
  const linkClicksCount = document.getElementById('link-clicks-count');
  const resultShortCode = document.getElementById('result-short-code');
  const resultOriginalUrl = document.getElementById('result-original-url');
  const copyShortLinkInput = document.getElementById('copy-short-link-input');
  const btnCopyShortLink = document.getElementById('btn-copy-short-link');
  const btnOpenShortLink = document.getElementById('btn-open-short-link');
  const btnSaveLinkQr = document.getElementById('btn-save-link-qr');
  const btnShortenAnother = document.getElementById('btn-shorten-another');
  const btnBurnLink = document.getElementById('btn-burn-link');

  // History & Toast DOM
  const historySection = document.getElementById('history-section');
  const historyList = document.getElementById('history-list');
  const linkHistorySection = document.getElementById('link-history-section');
  const linkHistoryList = document.getElementById('link-history-list');
  const toastContainer = document.getElementById('toast-container');

  // Format Bytes Utility
  function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // Format Remaining Time
  function formatCountdown(remainingMs) {
    if (remainingMs <= 0) return 'Expired';
    const totalSec = Math.floor(remainingMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    if (hours > 0) {
      return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  // Toast System
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        ${type === 'success' 
          ? '<polyline points="20 6 9 17 4 12"></polyline>' 
          : type === 'error' 
          ? '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>' 
          : '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>'}
      </svg>
      <span></span>
    `;
    toast.querySelector('span').textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Copy Helper
  async function copyTextToClipboard(text, inputFallbackEl) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      if (inputFallbackEl) {
        inputFallbackEl.select();
        document.execCommand('copy');
        return true;
      }
      const temp = document.createElement('input');
      temp.value = text;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      temp.remove();
      return true;
    }
  }

  // Navigation Tab Switching
  function switchTab(tabName, updateUrl = true) {
    activeTab = tabName === 'links' ? 'links' : 'files';

    if (activeTab === 'links') {
      navTabFiles.classList.remove('active');
      navTabLinks.classList.add('active');
      tabPanelFiles.style.display = 'none';
      tabPanelLinks.style.display = 'block';

      heroTitle.innerHTML = 'Shorten links & generate <span>Instant QR</span>';
      heroSubtitle.textContent = 'Create clean, fast short links with custom aliases and scannable QR codes. Built-in auto-expiration keeps your shared links private.';
      featureTtlText.textContent = 'Configurable Auto-Expiry';
      featureLimitText.textContent = 'Custom Alias & Instant QR';
    } else {
      navTabLinks.classList.remove('active');
      navTabFiles.classList.add('active');
      tabPanelLinks.style.display = 'none';
      tabPanelFiles.style.display = 'block';

      heroTitle.innerHTML = 'Transfer files directly via <span>Instant QR</span>';
      heroSubtitle.textContent = `Drop any file up to ${config.maxFileSizeMB}MB. Scan the generated QR code on your phone or tablet to download instantly. Everything auto-deletes permanently after 1 hour.`;
      featureTtlText.textContent = '1-Hour Auto Self-Destruct';
      featureLimitText.textContent = `${config.maxFileSizeMB} MB Max File Limit`;
    }

    if (updateUrl && window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.delete('expired');
      if (activeTab === 'links') {
        url.searchParams.set('tab', 'links');
      } else {
        url.searchParams.delete('tab');
      }
      window.history.replaceState({}, '', url.toString());
    }
  }

  navTabFiles.addEventListener('click', () => switchTab('files'));
  navTabLinks.addEventListener('click', () => switchTab('links'));

  // Fetch Server Config
  async function fetchConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        config = await res.json();
        if (config.publicUrl) {
          try {
            const parsed = new URL(config.publicUrl);
            aliasPrefixText.textContent = `${parsed.host}/s/`;
          } catch (e) {
            aliasPrefixText.textContent = '/s/';
          }
        }
      }
    } catch (e) {
      console.warn('Using default config settings:', e);
    }
  }

  // ================= FILE TRANSFER LOGIC =================
  function handleFileSelect(file) {
    if (!file) return;

    const maxBytes = config.maxFileSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      showToast(`File is too large! Maximum limit is ${config.maxFileSizeMB}MB (Selected: ${formatBytes(file.size)})`, 'error');
      fileInput.value = '';
      return;
    }

    stagedFile = file;
    stagedFileName.textContent = file.name;
    stagedFileSize.textContent = formatBytes(file.size);
    stagedFileType.textContent = file.type || 'Binary File';

    dropzone.style.display = 'none';
    fileStagedCard.style.display = 'block';
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-active');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-active');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      handleFileSelect(dt.files[0]);
    }
  });

  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  dropzone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });

  btnCancelFile.addEventListener('click', () => {
    stagedFile = null;
    fileInput.value = '';
    fileStagedCard.style.display = 'none';
    dropzone.style.display = 'flex';
  });

  btnStartUpload.addEventListener('click', () => {
    if (!stagedFile) return;

    btnStartUpload.disabled = true;
    fileStagedCard.style.display = 'none';
    progressContainer.style.display = 'block';

    const formData = new FormData();
    formData.append('file', stagedFile);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressFill.style.width = `${percent}%`;
        progressPercentage.textContent = `${percent}%`;
        progressStatusText.textContent = `Uploading: ${formatBytes(e.loaded)} / ${formatBytes(e.total)}`;
      }
    };

    xhr.onload = () => {
      btnStartUpload.disabled = false;
      progressContainer.style.display = 'none';

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.success && res.file) {
            showToast('Transfer ready! Scan QR code to download.', 'success');
            displayTransferResult(res.file);
            saveToHistory(res.file);
          } else {
            showToast('Upload failed: Invalid response', 'error');
            resetUploadView();
          }
        } catch (e) {
          showToast('Failed to parse server response', 'error');
          resetUploadView();
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          showToast(err.error || 'Upload failed', 'error');
        } catch (e) {
          showToast(`Upload failed (${xhr.status})`, 'error');
        }
        resetUploadView();
      }
    };

    xhr.onerror = () => {
      btnStartUpload.disabled = false;
      progressContainer.style.display = 'none';
      showToast('Network error while uploading. Please check connection.', 'error');
      resetUploadView();
    };

    xhr.send(formData);
  });

  function displayTransferResult(file) {
    activeTransfer = file;
    uploadView.style.display = 'none';
    resultView.style.display = 'block';

    resultFilename.textContent = file.name;
    resultFilesize.textContent = formatBytes(file.size);

    const baseHost = config.publicUrl || window.location.origin;
    const downloadPageUrl = file.downloadPageUrl || `${baseHost}/d/${file.id}`;
    const directDownloadUrl = file.directDownloadUrl || `${baseHost}/api/file/${file.id}/download`;

    copyLinkInput.value = downloadPageUrl;
    btnDirectDownload.href = directDownloadUrl;

    if (file.qrDataUrl) {
      qrImage.src = file.qrDataUrl;
    } else {
      qrImage.src = `/api/qr?text=${encodeURIComponent(downloadPageUrl)}`;
    }

    startCountdown(file.expiresAt);
  }

  function startCountdown(expiresAt) {
    if (countdownInterval) clearInterval(countdownInterval);

    function update() {
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) {
        clearInterval(countdownInterval);
        liveCountdown.textContent = 'Expired';
        showToast('This transfer has reached its time limit and expired.', 'error');
        return;
      }
      liveCountdown.textContent = formatCountdown(remainingMs);
    }

    update();
    countdownInterval = setInterval(update, 1000);
  }

  function resetUploadView() {
    stagedFile = null;
    fileInput.value = '';
    activeTransfer = null;
    if (countdownInterval) clearInterval(countdownInterval);

    fileStagedCard.style.display = 'none';
    progressContainer.style.display = 'none';
    dropzone.style.display = 'flex';
    resultView.style.display = 'none';
    uploadView.style.display = 'block';
  }

  btnSendAnother.addEventListener('click', resetUploadView);

  btnCopyLink.addEventListener('click', async () => {
    await copyTextToClipboard(copyLinkInput.value, copyLinkInput);
    showToast('Download link copied to clipboard!', 'success');
  });

  btnSaveQr.addEventListener('click', () => {
    if (!qrImage.src || !activeTransfer) return;
    const a = document.createElement('a');
    a.href = qrImage.src;
    a.download = `beamdrop-qr-${activeTransfer.name}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('QR code image saved!', 'success');
  });

  btnBurnFile.addEventListener('click', async () => {
    if (!activeTransfer) return;
    if (!confirm('Are you sure you want to permanently delete this file from the server now?')) {
      return;
    }

    try {
      const res = await fetch(`/api/file/${activeTransfer.id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('File permanently destroyed.', 'success');
        removeFromHistory(activeTransfer.id);
        resetUploadView();
      } else {
        showToast('Failed to burn file.', 'error');
      }
    } catch (e) {
      showToast('Error communicating with server.', 'error');
    }
  });

  // ================= LINK SHORTENER LOGIC =================
  btnPasteUrl.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        longUrlInput.value = text.trim();
        longUrlInput.focus();
        showToast('URL pasted from clipboard!', 'info');
      } else {
        showToast('Clipboard is empty.', 'error');
      }
    } catch (e) {
      longUrlInput.focus();
      showToast('Press Ctrl+V / Cmd+V to paste your URL.', 'info');
    }
  });

  shortenerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUrl = longUrlInput.value.trim();
    const customCode = customAliasInput.value.trim();
    const ttlMinutes = parseInt(linkTtlSelect.value, 10) || 60;

    if (!rawUrl) {
      showToast('Please enter a destination URL to shorten.', 'error');
      longUrlInput.focus();
      return;
    }

    btnShortenSubmit.disabled = true;

    try {
      const res = await fetch('/api/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl, customCode, ttlMinutes })
      });

      const data = await res.json();
      btnShortenSubmit.disabled = false;

      if (res.ok && data.success && data.link) {
        showToast('Short link & QR code generated!', 'success');
        displayLinkResult(data.link);
        saveLinkToHistory(data.link);
      } else {
        showToast(data.error || 'Failed to shorten URL.', 'error');
      }
    } catch (err) {
      btnShortenSubmit.disabled = false;
      showToast('Network error while shortening URL.', 'error');
    }
  });

  function displayLinkResult(link) {
    activeLink = link;
    shortenerFormView.style.display = 'none';
    linkResultView.style.display = 'block';

    const baseHost = config.publicUrl || window.location.origin;
    const shortUrl = link.shortUrl || `${baseHost}/s/${link.code}`;

    resultShortCode.textContent = `/s/${link.code}`;
    resultOriginalUrl.textContent = link.originalUrl;
    resultOriginalUrl.title = link.originalUrl;
    linkClicksCount.textContent = link.clicks || 0;

    copyShortLinkInput.value = shortUrl;
    btnOpenShortLink.href = shortUrl;

    if (link.qrDataUrl) {
      linkQrImage.src = link.qrDataUrl;
    } else {
      linkQrImage.src = `/api/qr?text=${encodeURIComponent(shortUrl)}`;
    }

    startLinkCountdown(link.expiresAt);
  }

  function startLinkCountdown(expiresAt) {
    if (linkCountdownInterval) clearInterval(linkCountdownInterval);

    function update() {
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) {
        clearInterval(linkCountdownInterval);
        linkLiveCountdown.textContent = 'Expired';
        showToast('This shortened link has expired.', 'error');
        return;
      }
      linkLiveCountdown.textContent = formatCountdown(remainingMs);
    }

    update();
    linkCountdownInterval = setInterval(update, 1000);
  }

  function resetShortenerView() {
    activeLink = null;
    if (linkCountdownInterval) clearInterval(linkCountdownInterval);
    longUrlInput.value = '';
    customAliasInput.value = '';
    linkResultView.style.display = 'none';
    shortenerFormView.style.display = 'block';
  }

  btnShortenAnother.addEventListener('click', resetShortenerView);

  btnCopyShortLink.addEventListener('click', async () => {
    await copyTextToClipboard(copyShortLinkInput.value, copyShortLinkInput);
    showToast('Short link copied to clipboard!', 'success');
  });

  btnSaveLinkQr.addEventListener('click', () => {
    if (!linkQrImage.src || !activeLink) return;
    const a = document.createElement('a');
    a.href = linkQrImage.src;
    a.download = `beamdrop-link-qr-${activeLink.code}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('QR code image saved!', 'success');
  });

  btnBurnLink.addEventListener('click', async () => {
    if (!activeLink) return;
    if (!confirm('Are you sure you want to permanently delete this shortened link now?')) {
      return;
    }

    try {
      const res = await fetch(`/api/link/${activeLink.code}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Short link burned and permanently deleted.', 'success');
        removeLinkFromHistory(activeLink.code);
        resetShortenerView();
      } else {
        showToast('Failed to burn short link.', 'error');
      }
    } catch (e) {
      showToast('Error communicating with server.', 'error');
    }
  });

  // ================= SESSION HISTORY (FILES & LINKS) =================
  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem('beamdrop_history') || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveToHistory(file) {
    let history = getHistory();
    history = history.filter(h => h.id !== file.id && h.expiresAt > Date.now());
    history.unshift({
      id: file.id,
      name: file.name,
      size: file.size,
      expiresAt: file.expiresAt
    });
    localStorage.setItem('beamdrop_history', JSON.stringify(history.slice(0, 5)));
    renderHistory();
  }

  function removeFromHistory(id) {
    let history = getHistory().filter(h => h.id !== id);
    localStorage.setItem('beamdrop_history', JSON.stringify(history));
    renderHistory();
  }

  function renderHistory() {
    const history = getHistory().filter(h => h.expiresAt > Date.now());
    if (history.length === 0) {
      historySection.style.display = 'none';
      return;
    }

    historySection.style.display = 'block';
    historyList.innerHTML = '';

    history.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';
      
      const minsLeft = Math.max(1, Math.round((item.expiresAt - Date.now()) / 60000));
      const baseUrl = config.publicUrl || window.location.origin;
      const shareUrl = `${baseUrl}/d/${item.id}`;

      el.innerHTML = `
        <div class="history-info">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-cyan); flex-shrink: 0;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
          <div style="min-width: 0;">
            <div class="history-name"></div>
            <div class="history-sub">${formatBytes(item.size)}</div>
          </div>
        </div>
        <div class="history-actions">
          <span class="history-badge">~${minsLeft}m left</span>
          <div class="history-btn-group">
            <button type="button" class="history-btn btn-hist-copy">Copy</button>
            <button type="button" class="history-btn btn-hist-qr">View QR</button>
          </div>
        </div>
      `;
      el.querySelector('.history-name').textContent = item.name;

      el.querySelector('.btn-hist-copy').addEventListener('click', async () => {
        await copyTextToClipboard(shareUrl);
        showToast('Transfer link copied!', 'success');
      });

      el.querySelector('.btn-hist-qr').addEventListener('click', async () => {
        try {
          const res = await fetch(`/api/file/${item.id}`);
          if (res.ok) {
            const data = await res.json();
            switchTab('files');
            displayTransferResult({
              id: data.id,
              name: data.name,
              size: data.size,
              expiresAt: data.expiresAt,
              downloadPageUrl: `${baseUrl}/d/${data.id}`,
              directDownloadUrl: `${baseUrl}/api/file/${data.id}/download`
            });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            showToast('This transfer has already expired', 'error');
            removeFromHistory(item.id);
          }
        } catch (e) {
          showToast('Could not load transfer', 'error');
        }
      });

      historyList.appendChild(el);
    });
  }

  // Shortened Links History
  function getLinkHistory() {
    try {
      return JSON.parse(localStorage.getItem('beamdrop_links_history') || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveLinkToHistory(link) {
    let history = getLinkHistory();
    history = history.filter(h => h.code !== link.code && (!h.expiresAt || h.expiresAt > Date.now()));
    history.unshift({
      code: link.code,
      originalUrl: link.originalUrl,
      shortUrl: link.shortUrl,
      expiresAt: link.expiresAt
    });
    localStorage.setItem('beamdrop_links_history', JSON.stringify(history.slice(0, 5)));
    renderLinkHistory();
  }

  function removeLinkFromHistory(code) {
    let history = getLinkHistory().filter(h => h.code !== code);
    localStorage.setItem('beamdrop_links_history', JSON.stringify(history));
    renderLinkHistory();
  }

  function renderLinkHistory() {
    const history = getLinkHistory().filter(h => !h.expiresAt || h.expiresAt > Date.now());
    if (history.length === 0) {
      linkHistorySection.style.display = 'none';
      return;
    }

    linkHistorySection.style.display = 'block';
    linkHistoryList.innerHTML = '';

    history.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';

      const minsLeft = Math.max(1, Math.round((item.expiresAt - Date.now()) / 60000));
      const timeLabel = minsLeft >= 60 ? `~${Math.round(minsLeft / 60)}h left` : `~${minsLeft}m left`;
      const baseUrl = config.publicUrl || window.location.origin;
      const shortUrl = item.shortUrl || `${baseUrl}/s/${item.code}`;

      el.innerHTML = `
        <div class="history-info">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-cyan); flex-shrink: 0;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
          <div style="min-width: 0;">
            <div class="history-name">/s/${item.code}</div>
            <div class="history-sub"></div>
          </div>
        </div>
        <div class="history-actions">
          <span class="history-badge">${timeLabel}</span>
          <div class="history-btn-group">
            <button type="button" class="history-btn btn-link-copy">Copy</button>
            <button type="button" class="history-btn btn-link-qr">View QR</button>
          </div>
        </div>
      `;
      el.querySelector('.history-sub').textContent = item.originalUrl;

      el.querySelector('.btn-link-copy').addEventListener('click', async () => {
        await copyTextToClipboard(shortUrl);
        showToast('Short link copied!', 'success');
      });

      el.querySelector('.btn-link-qr').addEventListener('click', async () => {
        try {
          const res = await fetch(`/api/link/${item.code}`);
          if (res.ok) {
            const data = await res.json();
            switchTab('links');
            displayLinkResult(data);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            showToast('This short link has already expired', 'error');
            removeLinkFromHistory(item.code);
          }
        } catch (e) {
          showToast('Could not load short link', 'error');
        }
      });

      linkHistoryList.appendChild(el);
    });
  }

  // Check URL params on initial load
  function handleInitialQuery() {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const expiredParam = params.get('expired');

    if (tabParam === 'links' || window.location.hash === '#links' || window.location.hash === '#shortener') {
      switchTab('links', false);
    }

    if (expiredParam === 'link') {
      switchTab('links', false);
      showToast('That shortened link has expired or does not exist.', 'error');
    }
  }

  // Initialize
  fetchConfig().then(() => {
    renderHistory();
    renderLinkHistory();
  });
  handleInitialQuery();

})();
