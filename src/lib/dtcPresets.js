/* Blocos DTC pré-prontos — versões EMAIL-SAFE (tabelas + estilos inline, cores fixas,
   sem CSS grid / variáveis / @import / ::before). Renderiza no Gmail, Outlook, Apple Mail etc.
   Só um <style> com @media pra empilhar as colunas no mobile (degrada bem se o cliente ignorar). */

const GELABURN_PRECOS = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
  <style>
    @media only screen and (max-width:620px){
      .gb-col{display:block !important;width:100% !important;max-width:420px !important;margin:0 auto 16px auto !important;padding:0 !important;}
    }
  </style>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:660px;margin:0 auto;">
    <tr>
      <!-- BASIC (2 bottles) -->
      <td class="gb-col" width="33.33%" valign="top" style="padding:6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:2px solid #1d8f5c;border-radius:14px;overflow:hidden;">
          <tr><td style="background:#0f4d32;color:#ffffff;font-weight:800;text-align:center;padding:8px 6px;font-size:14px;text-transform:uppercase;">Basic</td></tr>
          <tr><td style="text-align:center;padding:12px 8px 2px;line-height:1.1;">
            <div style="font-size:22px;font-weight:800;color:#1f2933;">2 BOTTLES</div>
            <div style="font-size:12px;color:#1f2933;text-transform:uppercase;">60 DAY SUPPLY</div>
          </td></tr>
          <tr><td style="text-align:center;padding:6px 8px;"><img src="https://i.ibb.co/FLHgj0Yc/MP-2.webp" alt="2 Bottles" width="160" style="max-width:100%;height:auto;display:block;margin:0 auto;border:0;"></td></tr>
          <tr><td style="text-align:center;padding:2px 8px;color:#1f2933;line-height:1;">
            <span style="font-size:40px;font-weight:800;">$79</span><span style="font-size:12px;font-weight:800;"> PER BOTTLE</span>
          </td></tr>
          <tr><td style="padding:8px 12px;font-size:12px;font-weight:800;color:#1f2933;text-align:center;">
            <div style="padding:6px 0;border-top:1px dashed rgba(0,0,0,.42);border-bottom:1px dashed rgba(0,0,0,.42);color:#1d8f5c;">✓ YOU SAVE $200!</div>
            <div style="padding:6px 0;border-bottom:1px dashed rgba(0,0,0,.42);">✓ 60 DAYS GUARANTEE</div>
          </td></tr>
          <tr><td style="padding:8px 12px 4px;">
            <a href="https://track.seniorconsumernow.com/click/1" style="display:block;background:#e0e0e0;color:#1f2933;text-align:center;text-decoration:none;font-weight:900;font-size:16px;padding:13px 8px;border-radius:8px;">🛒 BUY NOW</a>
          </td></tr>
          <tr><td style="text-align:center;padding:4px 8px 14px;font-size:13px;color:#1f2933;line-height:1.4;">
            <div>Total: <s style="text-decoration-color:#dc3545;">$358</s> <b>$158</b></div>
            <div style="font-weight:800;text-transform:uppercase;">+ $9.99 SHIPPING</div>
          </td></tr>
        </table>
      </td>

      <!-- PROMO (6 bottles) — DESTAQUE -->
      <td class="gb-col" width="33.33%" valign="top" style="padding:6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#123a56;border:2px solid #1e5f8f;border-radius:14px;overflow:hidden;">
          <tr><td style="background:#ffffff;color:#0f4d32;font-weight:800;text-align:center;padding:8px 6px;font-size:14px;text-transform:uppercase;">Best Value!</td></tr>
          <tr><td style="text-align:center;padding:12px 8px 2px;line-height:1.1;color:#ffffff;">
            <div style="font-size:22px;font-weight:800;">6 BOTTLES</div>
            <div style="font-size:12px;text-transform:uppercase;">180 DAY SUPPLY</div>
          </td></tr>
          <tr><td style="text-align:center;padding:6px 8px;"><img src="https://i.ibb.co/Q3mPPzTG/MP-6.webp" alt="6 Bottles" width="170" style="max-width:100%;height:auto;display:block;margin:0 auto;border:0;"></td></tr>
          <tr><td style="text-align:center;padding:2px 8px;color:#ffffff;line-height:1;">
            <span style="font-size:44px;font-weight:800;">$49</span><span style="font-size:12px;font-weight:800;"> PER BOTTLE</span>
          </td></tr>
          <tr><td style="padding:8px 12px;font-size:12px;font-weight:800;color:#ffffff;text-align:center;">
            <div style="padding:6px 0;border-top:1px dashed rgba(255,255,255,.42);border-bottom:1px dashed rgba(255,255,255,.42);color:#ffd966;">✓ YOU SAVE $780!</div>
            <div style="padding:6px 0;border-bottom:1px dashed rgba(255,255,255,.42);">✓ BIGGEST DISCOUNT</div>
            <div style="padding:6px 0;border-bottom:1px dashed rgba(255,255,255,.42);">✓ 60 DAYS GUARANTEE</div>
          </td></tr>
          <tr><td style="padding:8px 12px 4px;">
            <a href="https://track.seniorconsumernow.com/click/3" style="display:block;background:#ffd814;color:#1f2933;text-align:center;text-decoration:none;font-weight:900;font-size:16px;padding:13px 8px;border-radius:8px;">🛒 BUY NOW</a>
          </td></tr>
          <tr><td style="text-align:center;padding:4px 8px 14px;font-size:13px;color:#ffffff;line-height:1.4;">
            <div>Total: <s style="text-decoration-color:#dc3545;">$1074</s> <b>$294</b></div>
            <div style="font-weight:800;text-transform:uppercase;">+ <span style="color:#ffd966;">FREE</span> SHIPPING</div>
          </td></tr>
        </table>
      </td>

      <!-- MID (3 bottles) -->
      <td class="gb-col" width="33.33%" valign="top" style="padding:6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:2px solid #1d8f5c;border-radius:14px;overflow:hidden;">
          <tr><td style="background:#0f4d32;color:#ffffff;font-weight:800;text-align:center;padding:8px 6px;font-size:14px;text-transform:uppercase;">Most Popular</td></tr>
          <tr><td style="text-align:center;padding:12px 8px 2px;line-height:1.1;">
            <div style="font-size:22px;font-weight:800;color:#1f2933;">3 BOTTLES</div>
            <div style="font-size:12px;color:#1f2933;text-transform:uppercase;">90 DAY SUPPLY</div>
          </td></tr>
          <tr><td style="text-align:center;padding:6px 8px;"><img src="https://i.ibb.co/PvfxscjH/MP-3.webp" alt="3 Bottles" width="160" style="max-width:100%;height:auto;display:block;margin:0 auto;border:0;"></td></tr>
          <tr><td style="text-align:center;padding:2px 8px;color:#1f2933;line-height:1;">
            <span style="font-size:40px;font-weight:800;">$69</span><span style="font-size:12px;font-weight:800;"> PER BOTTLE</span>
          </td></tr>
          <tr><td style="padding:8px 12px;font-size:12px;font-weight:800;color:#1f2933;text-align:center;">
            <div style="padding:6px 0;border-top:1px dashed rgba(0,0,0,.42);border-bottom:1px dashed rgba(0,0,0,.42);color:#1d8f5c;">✓ YOU SAVE $330!</div>
            <div style="padding:6px 0;border-bottom:1px dashed rgba(0,0,0,.42);">✓ BIGGEST DISCOUNT</div>
            <div style="padding:6px 0;border-bottom:1px dashed rgba(0,0,0,.42);">✓ 60 DAYS GUARANTEE</div>
          </td></tr>
          <tr><td style="padding:8px 12px 4px;">
            <a href="https://track.seniorconsumernow.com/click/2" style="display:block;background:#e0e0e0;color:#1f2933;text-align:center;text-decoration:none;font-weight:900;font-size:16px;padding:13px 8px;border-radius:8px;">🛒 BUY NOW</a>
          </td></tr>
          <tr><td style="text-align:center;padding:4px 8px 14px;font-size:13px;color:#1f2933;line-height:1.4;">
            <div>Total: <s style="text-decoration-color:#dc3545;">$537</s> <b>$207</b></div>
            <div style="font-weight:800;text-transform:uppercase;">+ <span style="color:#dc3545;">FREE</span> SHIPPING</div>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</div>`

/** Lista de DTCs pré-prontos. `nome` aparece no popup; `html` é inserido no e-mail. */
export const DTC_PRESETS = [
  {
    id: 'gelaburn-precos-3ofertas',
    nome: 'Preços — 3 ofertas (verde/azul)',
    descricao: '2 / 6 / 3 unidades, com destaque "BEST VALUE" — email-safe',
    html: GELABURN_PRECOS,
  },
]
