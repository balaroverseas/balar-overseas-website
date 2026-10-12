import { $, $$, bootInnerPage } from '../common.js';

const { ScrollTrigger } = window;

// Table of contents follows the section in view
bootInnerPage(() => {
  const links = $$('#legalToc a');
  links.forEach((a) => {
    ScrollTrigger.create({
      trigger: $(a.getAttribute('href')), start: 'top 45%', end: 'bottom 45%',
      onToggle: (s) => { if (s.isActive) links.forEach((l) => l.classList.toggle('on', l === a)); },
    });
  });
});
