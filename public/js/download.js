// BeamDrop Download / Recipient Engine
(function() {
  'use strict';

  const pathParts = window.location.pathname.split('/');
  const fileId = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

  const loadingState = document.getElementById('loading-state');
  const fileReadyState = document.getElementById('file-ready-state');
  const expiredState = document.getElementById('expired-state');

  const fileName = document.getElementById('file-name');
  const fileSize = document.getElementById('file-size');
  const liveCountdown = document.getElementById('live-countdown');
  const btnDownload = document.getElementById('btn-download');
  const btnBurnRecipient = document.getElementById('btn-burn-recipient');
  const imagePreviewBox = document.getElementById('image-preview-box');
  const imagePreview = document.getElementById('image-preview');
  const toastContainer = document.getElementById('toast-container');

  let countdownInterval = null;

  function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

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

  function startCountdown(expiresAt) {
    if (countdownInterval) clearInterval(countdownInterval);

    function update() {
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) {
        clearInterval(countdownInterval);
        showExpired();
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

  function showExpired() {
    loadingState.style.display = 'none';
    fileReadyState.style.display = 'none';
    expiredState.style.display = 'block';
  }

  async function loadFileMetadata() {
    if (!fileId) {
      showExpired();
      return;
    }

    try {
      const res = await fetch(`/api/file/${fileId}`);
      if (!res.ok) {
        showExpired();
        return;
      }

      const data = await res.json();
      fileName.textContent = data.name;
      fileSize.textContent = formatBytes(data.size);
      btnDownload.href = `/api/file/${fileId}/download`;

      // Auto check if image for quick preview
      const isImg = data.mimeType && data.mimeType.startsWith('image/') ||
        /\.(png|jpe?g|gif|webp|svg)$/i.test(data.name);

      if (isImg && data.size < 15 * 1024 * 1024) { // Only preview images under 15MB
        imagePreview.src = `/api/file/${fileId}/download`;
        imagePreviewBox.style.display = 'block';
      }

      startCountdown(data.expiresAt);

      loadingState.style.display = 'none';
      fileReadyState.style.display = 'block';
    } catch (err) {
      console.error(err);
      showExpired();
    }
  }

  btnBurnRecipient.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to permanently delete this file now? Nobody else will be able to download it.')) {
      return;
    }

    try {
      const res = await fetch(`/api/file/${fileId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('File burned and wiped permanently.', 'success');
        showExpired();
      } else {
        showToast('Failed to burn file.', 'error');
      }
    } catch (e) {
      showToast('Error communicating with server.', 'error');
    }
  });

  loadFileMetadata();
})();
