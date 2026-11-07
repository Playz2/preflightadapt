// aria-disabled păstrează butonul accesibil la click și tastatură pentru explicație.
const labels = new WeakMap();
function restoreLabel(button) {
  const previous = labels.get(button);
  if (!previous) return;
  if (button.textContent === previous.reason) button.textContent = previous.label;
  labels.delete(button);
}

export function setButtonUnavailable(button, unavailable, reason = "Acțiunea nu este disponibilă acum.") {
  restoreLabel(button);
  button.disabled = false;
  button.setAttribute("aria-disabled", String(unavailable));
  if (unavailable) button.dataset.unavailableReason = reason;
  else delete button.dataset.unavailableReason;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest?.('button[aria-disabled="true"]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const reason = button.dataset.unavailableReason || "Acțiunea nu este disponibilă acum.";
  if (!labels.has(button)) labels.set(button, { label: button.textContent, reason });
  button.textContent = reason;
  button.addEventListener("blur", () => restoreLabel(button), { once: true });
}, true);
