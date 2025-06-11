function openWhatsApp(event) {
  const phone = "918341949651";
  const message = "Hi, I just viewed your biodata at https://altafjava.github.io/biodata/. I'd like to connect and learn more if you're open to it.";
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
  event.preventDefault();
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function handlePhoneClick(event) {
  const phoneNumber = "+918341949651";
  if (isMobileDevice()) {
    window.location.href = `tel:${phoneNumber}`; // For mobile devices, open phone dialer
  } else {
    navigator.clipboard.writeText(phoneNumber); // For desktop/tablet, copy to clipboard
    showToast("Phone number copied!");
  }
  event.preventDefault();
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 100);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
