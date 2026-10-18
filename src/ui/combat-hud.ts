/** Jak dlouho zůstane zpráva zobrazená, v sekundách. */
const MESSAGE_TIME = 2.2;
const HIT_MARKER_TIME = 0.15;

export interface CombatState {
  health: number;
  magazine: number;
  reloading: boolean;
  score: number;
  /** Čtvrti získané zpět a kolik jich gang na začátku držel. */
  taken: number;
  total: number;
  /** Ukazatel munice sdílí roh s tachometrem. */
  showAmmo: boolean;
  /** 0 až 1, červený záblesk po zásahu. */
  hurt: number;
}

/** Ukazatele na obrazovce pro válku gangů: zdraví, munice, skóre, zprávy, odezva zásahu. */
export class CombatHud {
  private readonly health: HTMLElement;
  private readonly healthValue: HTMLElement;
  private readonly ammo: HTMLElement;
  private readonly ammoValue: HTMLElement;
  private readonly scoreValue: HTMLElement;
  private readonly districts: HTMLElement;
  private readonly message: HTMLElement;
  private readonly damage: HTMLElement;
  private readonly crosshair: HTMLElement;
  private messageLeft = 0;
  private hitLeft = 0;

  constructor() {
    const get = (selector: string): HTMLElement => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`Missing HUD element ${selector}`);
      return el;
    };
    this.health = get('#health');
    this.healthValue = get('#health .value');
    this.ammo = get('#ammo');
    this.ammoValue = get('#ammo .value');
    this.scoreValue = get('#score .value');
    this.districts = get('#score .districts');
    this.message = get('#message');
    this.damage = get('#damage');
    this.crosshair = get('#crosshair');
  }

  update(state: CombatState, dt: number): void {
    setText(this.healthValue, String(Math.ceil(state.health)));
    this.health.classList.toggle('low', state.health < 30);
    this.ammo.hidden = !state.showAmmo;
    setText(this.ammoValue, state.reloading ? '\u2026' : String(state.magazine));
    setText(this.scoreValue, state.score.toLocaleString());
    setText(this.districts, `${state.taken} / ${state.total} districts taken`);
    this.damage.style.opacity = String(state.hurt);

    this.messageLeft -= dt;
    this.message.style.opacity = this.messageLeft > 0 ? '1' : '0';
    this.hitLeft -= dt;
    this.crosshair.classList.toggle('hit', this.hitLeft > 0);
  }

  announce(text: string, points = 0): void {
    const sign = points > 0 ? '+' : '';
    this.message.textContent = points ? `${text}  ${sign}${points}` : text;
    this.messageLeft = MESSAGE_TIME;
  }

  hitMarker(): void {
    this.hitLeft = HIT_MARKER_TIME;
  }
}

/** Zapisuje jen při změně, aby se na DOM zbytečně nesahalo každý snímek. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
