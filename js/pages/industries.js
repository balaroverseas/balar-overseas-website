import { $, $$, bootInnerPage } from '../common.js';

const { ScrollTrigger } = window;
const IMG = 'assets/img/photos/';

const INDUSTRIES = [
  ['Home & Kitchenware', 'Everyday essentials, sourced right, priced to sell', 'home-and-kitchen-1-1200x800.webp',
    'Kitchen and household products sell on price, finish and packaging. Small differences in material or coating decide whether a product gets five stars or gets returned.',
    'We source cookware, storage, tools and utility products from factories that already supply export markets, and inspect finish and packaging before every shipment.',
    ['Material & food-contact checks', 'Retail-ready packaging and labelling', 'Mixed-SKU consolidation in one container']],
  ['Health & Personal Care', 'Hygiene and wellness products with the right paperwork', 'Health-and-Cosmetics-1200x800.webp',
    'Personal-care and wellness goods need consistent quality and correct documentation to clear customs smoothly.',
    'We work with established manufacturers, collect the documents your category needs and check batch consistency before dispatch.',
    ['Supplier document checks', 'Batch & packaging consistency', 'Customs-ready paperwork']],
  ['Baby Products', 'Safe, certified essentials parents can trust', 'baby-products-1200x800.webp',
    'For baby products, safety and trust come before price. Materials, finishing and labelling must be right every time.',
    'We shortlist factories with a track record in children\'s products and inspect each order for sharp edges, material quality and labelling.',
    ['Certified-factory shortlisting', 'Safety-focused inspection', 'Clear, compliant labelling']],
  ['Beauty Products', 'Skincare and grooming, consistent batch after batch', 'beauty-and-cosmetics.webp',
    'Beauty buyers notice everything — colour, fragrance, packaging. Consistency between batches builds your brand.',
    'We coordinate samples, private-label packaging and batch checks so every shipment looks and performs like the last.',
    ['Sample & packaging approval', 'Private-label coordination', 'Batch-to-batch consistency checks']],
  ['Home & Office Furniture', 'Bulky goods, packed and loaded to arrive perfect', 'home-and-office-furniture.webp',
    'Furniture is heavy, bulky and easy to damage. Packing and container loading decide your margins.',
    'We check build quality, packing strength and carton marking, then plan container loading to maximise space and minimise damage.',
    ['Build & finish inspection', 'Export-grade packing checks', 'Optimised FCL loading plans']],
  ['Mobile Accessories', 'Fast-moving electronics accessories at the right price', 'mobile-accessories.webp',
    'Chargers, cables, cases and audio move fast and change fast. Speed and reliable quality matter equally.',
    'We source from proven accessory makers, test function on samples and shipments, and use air freight when launches can\'t wait.',
    ['Function testing before dispatch', 'Fast sample turnaround', 'Air freight for urgent launches']],
  ['Sports, Fitness & Outdoors', 'Performance gear, ready for the season', 'sports-and-outdoor.webp',
    'Fitness and outdoor products are seasonal. Missing the season means unsold stock.',
    'We plan production and shipping backwards from your launch date and check durability and finishing before goods leave the factory.',
    ['Season-based production planning', 'Durability & finish checks', 'Consolidated multi-supplier shipments']],
  ['Toys & Games', 'Creative, safe and on shelves before peak season', 'toys-and-games.webp',
    'Toys combine safety requirements with tight festive-season deadlines.',
    'We work with experienced toy factories, check safety and packaging, and lock shipping space early for peak periods.',
    ['Safety-focused QC', 'Gift-ready packaging', 'Early booking for peak season']],
  ['Electronics', 'Gadgets and appliances that work out of the box', 'Electronics.webp',
    'Electronics need working samples, consistent components and careful handling in transit.',
    'We verify specifications, test units during inspection and pack and ship them to avoid damage and delays.',
    ['Spec & component verification', 'Power-on testing during QC', 'Protective packing & handling']],
];

function renderRows() {
  $('#indRows').innerHTML = INDUSTRIES.map(([title, tag, img, p1, p2, bullets], i) => `
    <article class="ind-row rise">
      <span class="mono">${String(i + 1).padStart(2, '0')}</span>
      <div><div class="tag">${tag}</div><a href="contact.html" class="btn btn-line">Work with us</a></div>
      <div>
        <h2 class="display">${title}</h2>
        <p>${p1}</p><p>${p2}</p>
        <span class="mono why">Why choose us</span>
        <ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
      </div>
      <img src="${IMG}${img}" alt="${title}" loading="lazy">
    </article>`).join('');
}

bootInnerPage(async () => {
  renderRows();
  const lines = $$('.road-lines p');
  let road = null;
  try {
    const { initRoadHero } = await import('../scenes/roadhero.js');
    road = initRoadHero($('#roadCanvas'));
  } catch (e) { console.warn('[3D] road hero unavailable', e); }
  ScrollTrigger.create({
    trigger: '#roadHero', start: 'top top', end: 'bottom bottom',
    onUpdate: (s) => {
      road && road.setProgress(s.progress);
      const i = Math.min(lines.length - 1, Math.floor(s.progress * lines.length));
      lines.forEach((l, k) => l.classList.toggle('on', k === i));
    },
  });
});
