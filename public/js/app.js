// BeamDrop Frontend Engine
(function() {
  'use strict';

  // State
  let config = {
    port: 3055,
    maxFileSizeMB: 150,
    fileTtlMinutes: 60,
    publicUrl: window.location.origin
  };

  let stagedFile = null;
  let activeTransfer = null;
  let countdownInterval = null;

  // DOM Elements
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

  const historySection = document.getElementById('history-section');
  const historyList = document.getElementById('history-list');
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
      <span>${message}</span>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Fetch Server Config
  async function fetchConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        config = await res.json();
      }
    } catch (e) {
      console.warn('Using default config settings:', e);
    }
  }

  // File Selection Handling
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

  // Drag & Drop Listeners
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

  // Perform Upload
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

  // Display QR Code & Transfer Details
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

  // Countdown Timer
  function startCountdown(expiresAt) {
    if (countdownInterval) clearInterval(countdownInterval);

    function update() {
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) {
        clearInterval(countdownInterval);
        liveCountdown.textContent = 'Expired';
        showToast('This transfer has reached its 1-hour limit and expired.', 'error');
        return;
      }

      const totalSec = Math.floor(remainingMs / 1000);
      const minutes = Math.floor(totalSec / 60);
      const seconds = totalSec % 60;
      liveCountdown.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    update();
    countdownInterval = setInterval(update, 1000);
  }

  // Reset to Upload View
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

  // Copy Download Link
  btnCopyLink.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(copyLinkInput.value);
      showToast('Link copied to clipboard!', 'success');
    } catch (e) {
      copyLinkInput.select();
      document.execCommand('copy');
      showToast('Link copied to clipboard!', 'success');
    }
  });

  // Save QR Code Image
  btnSaveQr.addEventListener('click', () => {
    if (!qrImage.src) return;
    const a = document.createElement('a');
    a.href = qrImage.src;
    a.download = `beamdrop-qr-${activeTransfer.name}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('QR code saved!', 'success');
  });

  // Burn / Destroy File
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

  // Local Storage History
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
      
      const minsLeft = Math.max(0, Math.round((item.expiresAt - Date.now()) / 60000));

      el.innerHTML = `
        <div class="history-info">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-cyan); flex-shrink: 0;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
          <div>
            <div class="history-name">${item.name}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">${formatBytes(item.size)}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span class="history-badge">~${minsLeft}m left</span>
          <button type="button" class="btn-copy" style="padding: 0.4rem 0.75rem; font-size: 0.8rem;" data-id="${item.id}">View QR</button>
        </div>
      `;

      el.querySelector('button').addEventListener('click', async () => {
        try {
          const res = await fetch(`/api/file/${item.id}`);
          if (res.ok) {
            const data = await res.json();
            const baseUrl = config.publicUrl || window.location.origin;
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

  // Initialize
  fetchConfig();
  renderHistory();

})();
