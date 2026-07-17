/* Blocos DTC pré-prontos (HTML + CSS completos) pro construtor de e-mail.
   Cada um é inserido "como está" ao ser escolhido no popup de pré-prontos. */

const GELABURN_PRECOS = `<div class="hp-gelaburn-island">
  <style>
  @import url("https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,300..900;1,300..900&display=swap");

  .hp-gelaburn-island {
    --gb-primary: #1e5f8f;
    --gb-secondary: #1d8f5c;
    --gb-third: #2a6fad;
    --gb-fourth: #5ec896;
    --gb-primary-light: #7eb8e8;
    --gb-primary-dark: #123a56;
    --gb-secondary-light: #7dd4a8;
    --gb-secondary-dark: #0f4d32;
    --gb-contrast: #ffd966;
    --gb-text: #1f2933;
    --gb-light: #f4f6f8;
    --gb-white: #ffffff;
    --gb-shadow-sm: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075);
    font-family: "Rubik", sans-serif;
    color: var(--gb-text);
    font-size: 20px;
    line-height: 1.5;
    box-sizing: border-box;
  }

  .hp-gelaburn-island *,
  .hp-gelaburn-island *::before,
  .hp-gelaburn-island *::after {
    box-sizing: border-box;
  }

  .hp-gelaburn-island img {
    width: 100%;
    max-width: fit-content;
    height: auto;
    display: block;
    margin: 0 auto;
  }

  .hp-gelaburn-island b,
  .hp-gelaburn-island .gb-fw-bold {
    font-weight: 800;
  }

  .hp-gelaburn-island .gb-btn {
    background-image: linear-gradient(to top, #dadada 50%, #e0e0e0 51%);
    color: var(--gb-text) !important;
    border: none !important;
    font-family: "Rubik", sans-serif;
    font-size: 1.25em;
    font-weight: 900;
    border-radius: 0.5em;
    line-height: 1;
    padding: 0.5em 1.5em;
    text-decoration: none;
    box-shadow: 0 -4px rgba(0, 0, 0, 0.05) inset;
    transition: 0.2s;
  }

  .hp-gelaburn-island .gb-btn:hover {
    background-image: linear-gradient(to bottom, #dadada 50%, #e0e0e0 51%);
    box-shadow: 0 4px rgba(0, 0, 0, 0.05) inset;
  }

  .hp-gelaburn-island .gb-products {
    position: relative;
    padding: 1.5rem 0;
  }

  .hp-gelaburn-island .gb-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    align-items: center;
    max-width: 1140px;
    margin: 0 auto;
    padding: 0 0.75rem;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (min-width: 768px) {
    .hp-gelaburn-island .gb-grid-item[data-offer="basic"] { order: 1; }
    .hp-gelaburn-island .gb-grid-item[data-offer="promo"] { order: 2; }
    .hp-gelaburn-island .gb-grid-item[data-offer="mid"] { order: 3; }
  }

  .hp-gelaburn-island .gb-grid > .gb-grid-item > a {
    width: 100%;
    max-width: 420px;
    margin: 0 auto;
    display: block;
  }

  .hp-gelaburn-island .gb-item {
    display: block;
    text-decoration: none;
    text-align: center;
    padding: 3px;
    color: var(--gb-text);
    background-color: var(--gb-white);
    border-radius: 1em;
    overflow: hidden;
    border: 2px solid var(--gb-secondary);
    box-shadow: var(--gb-shadow-sm);
    transition: 0.2s;
  }

  .hp-gelaburn-island .gb-item:hover {
    scale: 1.025;
  }

  .hp-gelaburn-island .gb-item-inner {
    border-radius: 18px;
    overflow: hidden;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-item-inner {
      display: grid;
      grid-template-areas:
        "header header"
        "title info"
        "img info"
        "img totals"
        "footer footer";
      grid-template-columns: 1fr 1fr;
      align-items: center;
      column-gap: 0.5em;
      padding: 0.5em 0;
    }
  }

  .hp-gelaburn-island .gb-item-hdr {
    grid-area: title;
    padding: 0.25em 0.5em;
    background-color: var(--gb-secondary-dark);
    font-weight: 800;
    color: var(--gb-white);
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-item-hdr {
      background-color: transparent;
      font-size: 0.9em;
      padding: 0;
      color: var(--gb-text);
    }
  }

  .hp-gelaburn-island .gb-item-img {
    grid-area: img;
  }

  .hp-gelaburn-island .gb-supply {
    padding: 1em 0.5em;
    text-align: center;
    line-height: 1;
    text-transform: uppercase;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-supply {
      font-size: 0.8em;
      padding: 0;
    }
  }

  .hp-gelaburn-island .gb-supply b {
    display: block;
    font-size: 1.75em;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-supply b {
      font-size: 1.25em;
    }
  }

  .hp-gelaburn-island .gb-item-img img {
    max-height: 200px;
  }

  .hp-gelaburn-island .gb-item-info {
    grid-area: info;
  }

  .hp-gelaburn-island .gb-price {
    display: flex;
    text-align: start;
    gap: 0.25em;
    width: fit-content;
    margin: 0 auto;
    align-items: center;
    line-height: 1;
  }

  .hp-gelaburn-island .gb-price b {
    font-size: 4em;
    text-align: center;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-price b {
      font-size: 2.8em;
      letter-spacing: -0.06em;
    }
  }

  .hp-gelaburn-island .gb-price sup {
    font-size: 0.45em;
    top: -0.5em;
    position: relative;
  }

  .hp-gelaburn-island .gb-price span {
    font-weight: 800;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-price span {
      font-size: 0.65em;
    }
  }

  .hp-gelaburn-island .gb-savings {
    font-size: 0.7em;
    font-weight: 800;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-savings {
      font-size: 0.65em;
    }
  }

  .hp-gelaburn-island .gb-savings > div {
    padding: 0.5em;
    align-items: center;
    justify-content: center;
    border-bottom: 1px dashed rgba(0, 0, 0, 0.42);
  }

  .hp-gelaburn-island .gb-savings > div:first-child {
    border-top: 1px dashed rgba(0, 0, 0, 0.42);
    color: var(--gb-secondary);
  }

  .hp-gelaburn-island .gb-savings > div:nth-child(2) {
    display: none;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-savings > div {
      padding: 0.5em 0;
    }
  }

  .hp-gelaburn-island .gb-savings span {
    display: flex;
    width: fit-content;
    margin: 0 auto;
    align-items: center;
    justify-content: center;
    gap: 0.25em;
    line-height: 1;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-savings span {
      letter-spacing: -0.4px;
    }
  }

  .hp-gelaburn-island .gb-savings span::before {
    content: "✓";
    font-size: 1.5em;
    font-weight: normal;
    line-height: 1;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-savings span::before {
      font-size: 1em;
    }
  }

  .hp-gelaburn-island .gb-item-buy {
    grid-area: footer;
  }

  .hp-gelaburn-island .gb-item-buy .gb-btn {
    padding: 0.65em;
    margin: 0.5em 0.25em;
    width: calc(100% - 0.5em);
    cursor: pointer;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-item-buy .gb-btn {
      margin-top: 0;
      margin-bottom: 0;
      font-size: 1.15em;
    }
  }

  .hp-gelaburn-island .gb-item-buy .gb-btn span {
    display: flex;
    width: fit-content;
    margin: 0 auto;
    align-items: center;
    justify-content: center;
    gap: 0.25em;
  }

  .hp-gelaburn-island .gb-item-buy .gb-btn span::before {
    content: "🛒";
    font-size: 0.9em;
    line-height: 1;
  }

  .hp-gelaburn-island .gb-card-flags {
    max-width: 220px;
    margin: 0 auto 0.5em;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-card-flags {
      display: none;
    }
  }

  .hp-gelaburn-island .gb-item-totals {
    grid-area: totals;
    font-size: 0.9em;
    padding-bottom: 1em;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-item-totals {
      font-size: 0.8em;
    }
  }

  .hp-gelaburn-island .gb-totals s {
    text-decoration-color: red;
    text-decoration-thickness: 2px;
  }

  .hp-gelaburn-island .gb-shipping {
    font-weight: 800;
    text-transform: uppercase;
  }

  .hp-gelaburn-island .gb-shipping .gb-free {
    color: #dc3545;
  }

  /* Promo (6 bottles) */
  .hp-gelaburn-island .gb-item-promo {
    color: var(--gb-white);
    background-color: var(--gb-white);
    text-shadow: 0 2px rgba(0, 38, 121, 0.64);
    border: 2px solid var(--gb-primary);
  }

  .hp-gelaburn-island .gb-item-promo .gb-item-inner {
    background-image: radial-gradient(var(--gb-primary-dark), var(--gb-primary));
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-item-promo .gb-item-inner {
      grid-template-areas:
        "header header"
        "img info"
        "img totals"
        "footer footer";
    }
  }

  .hp-gelaburn-island .gb-item-promo .gb-item-hdr {
    grid-area: header;
    background-color: var(--gb-white);
    color: var(--gb-secondary-dark);
    text-shadow: none;
    text-transform: uppercase;
  }

  @media (max-width: 767px) {
    .hp-gelaburn-island .gb-item-promo .gb-item-hdr {
      margin: -0.55em 0 0.5em;
      padding: 0.25em;
    }
  }

  .hp-gelaburn-island .gb-item-promo .gb-item-img img {
    max-height: 240px;
  }

  .hp-gelaburn-island .gb-item-promo .gb-savings > div {
    color: var(--gb-white);
    border-bottom: 1px dashed rgba(255, 255, 255, 0.42);
  }

  .hp-gelaburn-island .gb-item-promo .gb-savings > div:first-child {
    color: var(--gb-contrast);
    border-top: 1px dashed rgba(255, 255, 255, 0.42);
  }

  .hp-gelaburn-island .gb-item-promo .gb-savings > div:nth-child(2) {
    display: block;
  }

  .hp-gelaburn-island .gb-item-promo .gb-item-buy .gb-btn {
    color: var(--gb-text);
    background-image: linear-gradient(to top, #fccd15 50%, #ffd814 51%);
    text-shadow: none;
  }

  .hp-gelaburn-island .gb-item-promo .gb-item-buy .gb-btn:hover {
    background-image: linear-gradient(to bottom, #fccd15 50%, #ffd814 51%);
  }

  .hp-gelaburn-island .gb-item-promo .gb-shipping .gb-free {
    color: var(--gb-contrast);
  }
</style>
  <section class="gb-products">
    <div class="gb-grid">
      <div class="gb-grid-item" data-offer="promo">
        <a href="https://track.seniorconsumernow.com/click/3" title="6 Bottles" class="gb-item gb-item-promo">
          <div class="gb-item-inner">
            <div class="gb-item-hdr">BEST VALUE!</div>
            <div class="gb-item-img">
              <div class="gb-supply"><b>6 BOTTLES</b>180 DAY SUPPLY</div>
              <img src="https://i.ibb.co/Q3mPPzTG/MP-6.webp" alt="6 Bottles">
            </div>
            <div class="gb-item-info">
              <div class="gb-price">
                <b><sup>$</sup>49</b><span>PER<br>BOTTLE</span>
              </div>
              <div class="gb-savings">
                <div><span>YOU SAVE $780!</span></div>
                <div><span>BIGGEST DISCOUNT</span></div>
                <div><span>60 DAYS GUARANTEE</span></div>
              </div>
            </div>
            <div class="gb-item-buy">
              <div class="gb-btn">
                <div><span>BUY NOW</span></div>
              </div>
              <img src="https://getgelaburn.com/assets/main/products/img/cards-dark.webp" alt="Cards" class="gb-card-flags">
            </div>
            <div class="gb-item-totals">
              <div class="gb-totals">Total: <s>$1074</s> <b>$294</b></div>
              <div class="gb-shipping">+&nbsp;<span class="gb-free">FREE</span> SHIPPING</div>
            </div>
          </div>
        </a>
      </div>
      <div class="gb-grid-item" data-offer="mid">
        <a href="https://track.seniorconsumernow.com/click/2" title="3 Bottles" class="gb-item">
          <div class="gb-item-inner">
            <div class="gb-item-hdr">Most Popular</div>
            <div class="gb-item-img">
              <div class="gb-supply"><b>3 BOTTLES</b>90 DAY SUPPLY</div>
              <img src="https://i.ibb.co/PvfxscjH/MP-3.webp" alt="3 Bottles">
            </div>
            <div class="gb-item-info">
              <div class="gb-price">
                <b><sup>$</sup>69</b><span>PER<br>BOTTLE</span>
              </div>
              <div class="gb-savings">
                <div><span>YOU SAVE $330!</span></div>
                <div><span>BIGGEST DISCOUNT</span></div>
                <div><span>60 DAYS GUARANTEE</span></div>
              </div>
            </div>
            <div class="gb-item-buy">
              <div class="gb-btn">
                <div><span>BUY NOW</span></div>
              </div>
              <img src="https://getgelaburn.com/assets/main/products/img/cards.webp" alt="Cards" class="gb-card-flags">
            </div>
            <div class="gb-item-totals">
              <div class="gb-totals">Total: <s>$537</s> <b>$207</b></div>
              <div class="gb-shipping">+&nbsp;<span class="gb-free">FREE</span> SHIPPING</div>
            </div>
          </div>
        </a>
      </div>
      <div class="gb-grid-item" data-offer="basic">
        <a href="https://track.seniorconsumernow.com/click/1" title="2 Bottles" class="gb-item">
          <div class="gb-item-inner">
            <div class="gb-item-hdr">Basic</div>
            <div class="gb-item-img">
              <div class="gb-supply"><b>2 BOTTLES</b>60 DAY SUPPLY</div>
              <img src="https://i.ibb.co/FLHgj0Yc/MP-2.webp" alt="2 Bottles">
            </div>
            <div class="gb-item-info">
              <div class="gb-price">
                <b><sup>$</sup>79</b><span>PER<br>BOTTLE</span>
              </div>
              <div class="gb-savings">
                <div><span>YOU SAVE $200!</span></div>
                <div><span>BIGGEST DISCOUNT</span></div>
                <div><span>60 DAYS GUARANTEE</span></div>
              </div>
            </div>
            <div class="gb-item-buy">
              <div class="gb-btn">
                <div><span>BUY NOW</span></div>
              </div>
              <img src="https://getgelaburn.com/assets/main/products/img/cards.webp" alt="Cards" class="gb-card-flags">
            </div>
            <div class="gb-item-totals">
              <div class="gb-totals">Total: <s>$358</s> <b>$158</b></div>
              <div class="gb-shipping">+9.99 SHIPPING</div>
            </div>
          </div>
        </a>
      </div>
    </div>
  </section>
</div>`

/** Lista de DTCs pré-prontos. `nome` aparece no popup; `html` é inserido no e-mail. */
export const DTC_PRESETS = [
  {
    id: 'gelaburn-precos-3ofertas',
    nome: 'Preços — 3 ofertas (verde/azul)',
    descricao: '2 / 3 / 6 unidades, com destaque "BEST VALUE"',
    html: GELABURN_PRECOS,
  },
]
