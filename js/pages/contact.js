import { $, $$, bootInnerPage } from '../common.js';
import { drawDotMap } from '../fx/dotmap.js';

const WHATSAPP = '919898977266';
const EMAIL = 'balaroverseas@gmail.com';

// Builds the enquiry text from the form. No data is stored anywhere: it is handed
// to WhatsApp or the visitor's own mail app, and the visitor presses send there.
function enquiryText(form) {
  const f = new FormData(form);
  const reasons = f.getAll('reason');
  const line = (label, key) => (f.get(key) ? `${label}: ${f.get(key)}\n` : '');
  return `Hello Balar Overseas, I'd like a quote.\n\n`
    + (reasons.length ? `Enquiry: ${reasons.join(', ')}\n` : '')
    + line('Name', 'name') + line('Company', 'company') + line('Phone', 'phone')
    + line('Product', 'product') + line('Quantity', 'qty') + line('Delivery city', 'city')
    + line('Shipping', 'mode') + (f.get('message') ? `\n${f.get('message')}\n` : '');
}

function setupForm() {
  const form = $('#enquiry'), note = $('#formNote'), mail = $('#mailAlt');
  const required = $$('[required]', form);
  const valid = () => {
    let ok = true;
    required.forEach((el) => { const bad = !el.value.trim(); el.style.borderColor = bad ? '#e23b3b' : ''; if (bad) ok = false; });
    note.textContent = ok ? 'Opening WhatsApp…' : 'Please fill in the fields marked *.';
    note.style.color = ok ? '#1a9d55' : '#e23b3b';
    return ok;
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!valid()) return;
    window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(enquiryText(form))}`, '_blank', 'noopener');
  });
  mail.addEventListener('click', (e) => {
    e.preventDefault();
    if (!valid()) return;
    location.href = `mailto:${EMAIL}?subject=${encodeURIComponent('Quote request – ' + (new FormData(form).get('product') || ''))}&body=${encodeURIComponent(enquiryText(form))}`;
  });
}

bootInnerPage(async () => {
  setupForm();
  // dotted world map above the locations, like the reference
  const map = $('#cMap');
  if (map) drawDotMap(map, { gap: 6, dot: 2, color: '#cfcfcf', markers: [{ lat: 21.17, lon: 72.83, color: '#3b2cff' }, { lat: 23.13, lon: 113.26, color: '#3b2cff' }] }).catch(() => {});
});
