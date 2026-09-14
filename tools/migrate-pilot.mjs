import { readFile, writeFile } from "node:fs/promises";

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  console.error("Usage: node tools/migrate-pilot.mjs <standing-vector.svg> <character.svg>");
  process.exit(1);
}

const source = await readFile(sourcePath, "utf8");
const artwork = source.slice(source.indexOf(">", source.indexOf("<svg")) + 1, source.lastIndexOf("</svg>"));
if (!artwork) throw new Error("元SVGの内容を取得できませんでした");

const eyes = {
  left: { cx: 554, cy: 299, path: "M510 271 Q538 256 561 262 Q581 266 589 288 L586 310 Q574 326 549 324 Q525 320 516 291 Z" },
  right: { cx: 677, cy: 299, path: "M648 285 Q657 262 679 260 Q704 258 724 276 L713 302 Q705 325 680 324 Q656 322 651 309 Z" },
};

function eye(side, data) {
  const { cx, cy, path } = data;
  return `<g id="eye_${side}">
    <path id="eye_${side}_base" data-export-part="eye_${side}_base" d="${path}" fill="#fbd3b7"/>
    <g id="iris_${side}">
      <g id="eye_${side}_open" data-export-part="eye_${side}_open"><g clip-path="url(#${side}-eye-clip)"><use href="#pilot-source"/></g></g>
      <g id="eye_${side}_half" data-export-part="eye_${side}_half" transform="translate(0 ${cy * 0.45}) scale(1 .55)"><g clip-path="url(#${side}-eye-clip)"><use href="#pilot-source"/></g></g>
    </g>
    <g id="eye_${side}_closed" data-export-part="eye_${side}_closed"><path d="M${cx - 28} ${cy} Q${cx} ${cy + 14} ${cx + 28} ${cy}" fill="none" stroke="#563027" stroke-width="4.5" stroke-linecap="round"/></g>
    <g id="eye_${side}_smile" data-export-part="eye_${side}_smile"><path d="M${cx - 28} ${cy + 2} Q${cx} ${cy - 20} ${cx + 28} ${cy + 2}" fill="none" stroke="#563027" stroke-width="4.5" stroke-linecap="round"/></g>
  </g>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" role="img" aria-labelledby="character-title">
  <title id="character-title">既存パイロット版から移行した直立キャラクター</title>
  <defs>
    <g id="pilot-source">${artwork}</g>
    <mask id="face-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="1254" height="1254">
      <rect width="1254" height="1254" fill="white"/>
      <path d="${eyes.left.path}" fill="black"/><path d="${eyes.right.path}" fill="black"/>
      <ellipse cx="620" cy="356" rx="29" ry="13" fill="black"/>
    </mask>
    <clipPath id="left-eye-clip"><path d="${eyes.left.path}"/></clipPath>
    <clipPath id="right-eye-clip"><path d="${eyes.right.path}"/></clipPath>
  </defs>
  <g id="character">
    <g id="pose_root">
      <g id="body">
        <g id="master_normal" data-export-part="master_normal"><use href="#pilot-source" mask="url(#face-mask)"/></g>
        <g id="master_point" data-export-part="master_point"><use href="#pilot-source" mask="url(#face-mask)"/></g>
        <g id="master_alert" data-export-part="master_alert"><use href="#pilot-source" mask="url(#face-mask)"/></g>
        <g id="head">
          <g id="hair_sway" data-export-part="hair_sway" fill="none" stroke="#d89b37" stroke-width="5" stroke-linecap="round" opacity=".7">
            <path d="M487 229 Q473 278 492 327"/><path d="M748 222 Q767 276 746 329"/>
          </g>
          ${eye("left", eyes.left)}
          ${eye("right", eyes.right)}
          <g id="brows">
            <g id="brow_normal" data-export-part="brow_normal"></g>
            <g id="brow_raised" data-export-part="brow_raised"><path d="M537 234 Q559 233 580 249 L582 260 Q560 246 537 248 Z M665 240 Q679 230 693 237 L695 247 Q680 242 665 249 Z" fill="#fbd3b7"/><path d="M539 238 Q555 226 578 241 M666 234 Q680 225 692 235" fill="none" stroke="#8c5335" stroke-width="3.3" stroke-linecap="round"/></g>
            <g id="brow_worried" data-export-part="brow_worried"><path d="M537 234 Q559 233 580 249 L582 260 Q560 246 537 248 Z M665 240 Q679 230 693 237 L695 247 Q680 242 665 249 Z" fill="#fbd3b7"/><path d="M539 243 Q559 244 577 235 M666 234 Q680 240 692 243" fill="none" stroke="#8c5335" stroke-width="3.3" stroke-linecap="round"/></g>
          </g>
          <g id="mouth">
          <ellipse id="mouth_base" data-export-part="mouth_base" cx="620" cy="356" rx="29" ry="13" fill="#fbd3b7"/>
          <g id="mouth_closed" data-export-part="mouth_closed"><path d="M601 354 Q620 362 639 354" fill="none" stroke="#ac7057" stroke-width="2.1" stroke-linecap="round"/></g>
          <g id="mouth_small" data-export-part="mouth_small"><path d="M607 354 Q620 350 633 354 Q632 364 620 365 Q608 364 607 354 Z" fill="#68312f"/></g>
          <g id="mouth_medium" data-export-part="mouth_medium"><path d="M601 352 Q620 357 639 352 Q637 372 620 374 Q603 372 601 352 Z" fill="#68312f"/><path d="M609 369 Q620 363 631 369 Q620 375 609 369 Z" fill="#d98583"/></g>
          <g id="mouth_wide" data-export-part="mouth_wide"><path d="M595 350 Q620 357 645 350 Q642 379 620 381 Q598 379 595 350 Z" fill="#68312f"/><path d="M603 352 Q620 357 637 352 L635 358 Q620 362 605 358 Z" fill="#fff0df"/><path d="M606 375 Q620 367 634 375 Q620 382 606 375 Z" fill="#d98583"/></g>
          <g id="mouth_smile" data-export-part="mouth_smile"><path d="M597 352 Q620 369 642 352" fill="none" stroke="#ac7057" stroke-width="2.4" stroke-linecap="round"/></g>
          <g id="mouth_o" data-export-part="mouth_o"><ellipse cx="620" cy="357" rx="8" ry="11" fill="#713b38"/></g>
          <g id="mouth_smile_point" data-export-part="mouth_smile_point"><path d="M596 351 Q620 371 644 351" fill="none" stroke="#ac7057" stroke-width="2.6" stroke-linecap="round"/></g>
          </g>
          <g id="effects">
            <g id="blush" data-export-part="blush" fill="#ee998c" opacity=".32"><ellipse cx="541" cy="334" rx="18" ry="5"/><ellipse cx="696" cy="334" rx="18" ry="5"/></g>
            <g id="sweat" data-export-part="sweat"><path d="M753 276 Q775 304 753 326 Q731 304 753 276 Z" fill="#70c9eb" stroke="#fff" stroke-width="3"/></g>
            <g id="question" data-export-part="question"><text x="772" y="245" fill="#6f4aa8" stroke="#fff" stroke-width="2" paint-order="stroke" font-size="86" font-weight="800">?</text></g>
            <g id="exclamation" data-export-part="exclamation"><text x="770" y="245" fill="#e85e50" stroke="#fff" stroke-width="2" paint-order="stroke" font-size="86" font-weight="800">!</text></g>
            <g id="anger" data-export-part="anger" fill="none" stroke="#d84a43" stroke-width="8" stroke-linecap="round"><path d="M750 230 l24 -13 M758 241 l30 2 M744 219 l5 -28"/></g>
            <g id="shock" data-export-part="shock" fill="none" stroke="#efc33b" stroke-width="8" stroke-linecap="round"><path d="M455 235 l-35 -30 M446 260 l-48 -5 M777 231 l35 -32 M787 258 l48 -7"/></g>
          </g>
        </g>
      </g>
      <g id="pose_normal" data-export-part="pose_normal"></g>
      <g id="pose_explain" data-export-part="pose_explain" fill="#ffd76b" stroke="#fff" stroke-width="3"><path d="M428 412 l9 20 22 3-17 14 5 22-19-11-19 11 5-22-17-14 22-3 Z"/></g>
      <g id="pose_alert" data-export-part="pose_alert" fill="none" stroke="#f06f5c" stroke-width="8" stroke-linecap="round"><path d="M438 386 l-32-28 M425 410 l-43-4 M805 382 l32-30 M820 407 l44-6"/></g>
    </g>
  </g>
</svg>\n`;

await writeFile(outputPath, svg, "utf8");
console.log(`migrated pilot SVG: ${outputPath}`);
