import type { CSSProperties } from "react";

import { OWL_BODY, paletteOf } from "./owl-colors";
import type { OwlMood } from "./owl-mood";

/**
 * The flat owl: the same bird as the 3D Agent OWL (cream body and chest, a cap with a V point, brows and curled ear tufts in the agent's own colour, big eyes in orange rings, rosy cheeks,
 * orange beak and feet), drawn in SVG. It is the avatar everywhere (lists, cards, the landing table), the placeholder while the 3D owl loads, and the fallback when WebGL is missing, the
 * device is slow or the person wants less motion. Decorative by default (`aria-hidden`): the name beside it is the label. The five moods and `still` are in design/owl.css.
 * No ids inside (several owls share a page), no script, no three.js.
 */
export function OwlSvg({ agent = "main", mood = "idle", still = false, className = "size-12" }: { agent?: string; mood?: OwlMood; still?: boolean; className?: string }) {
  const p = paletteOf(agent);
  const vars = {
    "--owl-cap": p.cap,
    "--owl-cap-deep": p.capDeep,
    "--owl-cream": OWL_BODY.cream,
    "--owl-cream-light": OWL_BODY.creamLight,
    "--owl-cream-deep": OWL_BODY.creamDeep,
    "--owl-socket": OWL_BODY.socket,
    "--owl-accent": OWL_BODY.accent,
    "--owl-iris": OWL_BODY.iris,
    "--owl-iris-light": OWL_BODY.irisLight,
    "--owl-pupil": OWL_BODY.pupil,
    "--owl-cheek": OWL_BODY.cheek,
  } as CSSProperties;
  return (
    <svg viewBox="0 0 240 250" className={`owl shrink-0 ${className}`} data-state={mood} data-still={still ? "true" : undefined} data-owl={agent} aria-hidden="true" focusable="false">
      <g style={vars}>
      <circle className="ring" cx="120" cy="130" r="112" />
      <g className="whole">
        <g className="feet">
          {[84, 96, 108, 132, 144, 156].map((x) => (
            <ellipse key={x} cx={x} cy="237" rx="8" ry="6" />
          ))}
        </g>
        <circle className="body" cx="120" cy="138" r="90" />
        <ellipse className="chest" cx="120" cy="186" rx="58" ry="50" />
        <g className="scallops">
          <path d="M90 166q7 9 15 0q7 9 15 0q7 9 15 0q7 9 15 0" />
          <path d="M82 184q8 9 16 0q8 9 16 0q8 9 16 0q8 9 16 0q8 9 16 0" />
          <path d="M90 202q7 9 15 0q7 9 15 0q7 9 15 0q7 9 15 0" />
          <path d="M98 220q7 8 14 0q7 8 14 0q7 8 14 0" />
        </g>
        <g className="wing">
          <ellipse cx="32" cy="168" rx="19" ry="42" transform="rotate(16 32 168)" />
          <ellipse className="deep" cx="40" cy="198" rx="13" ry="22" transform="rotate(16 40 198)" />
          <ellipse cx="208" cy="168" rx="19" ry="42" transform="rotate(-16 208 168)" />
          <ellipse className="deep" cx="200" cy="198" rx="13" ry="22" transform="rotate(-16 200 198)" />
        </g>
        <g className="tufts">
          <path className="tuft" d="M80 62Q58 56 48 40Q44 29 55 28Q63 28 62 37" />
          <path className="tuft" d="M160 62Q182 56 192 40Q196 29 185 28Q177 28 178 37" />
        </g>
        <path className="cap" d="M33.8 112A90 90 0 0 1 206.2 112Q168 104 120 136Q72 104 33.8 112Z" />
        <ellipse className="brow" cx="84" cy="104" rx="22" ry="7" transform="rotate(-14 84 104)" />
        <ellipse className="brow" cx="156" cy="104" rx="22" ry="7" transform="rotate(14 156 104)" />
        <g className="eyes">
          {[86, 154].map((x) => (
            <g key={x}>
              <circle className="socket" cx={x} cy="132" r="27" />
              <circle className="iris" cx={x} cy="133" r="17" />
              <circle className="iris-light" cx={x - 2} cy="128" r="10" />
              <circle className="pupil" cx={x} cy="134" r="9" />
              <circle className="glint" cx={x + 4} cy="127" r="4" />
              <circle className="glint" cx={x - 5} cy="140" r="2" />
              <circle className="rim" cx={x} cy="132" r="27" />
              <circle className="lid" cx={x} cy="132" r="26" />
              <path className="happy" d={`M${x - 15} 138q15 -22 30 0`} />
            </g>
          ))}
        </g>
        <ellipse className="cheek" cx="56" cy="168" rx="13" ry="8" />
        <ellipse className="cheek" cx="184" cy="168" rx="13" ry="8" />
        <path className="beak" d="M109 152Q120 143 131 152Q129 170 120 178Q111 170 109 152Z" />
      </g>
      <g className="dots">
        <circle className="dot" cx="196" cy="30" r="6" />
        <circle className="dot" cx="214" cy="30" r="6" />
        <circle className="dot" cx="232" cy="30" r="6" />
      </g>
      </g>
    </svg>
  );
}
