export const HERO_FORM_SHEET = '/assets/grindion-hero-forms.png';

export const HERO_FORMS = [
	{ name: 'Wanderer', minScore: 0, column: 0, row: 0 },
	{ name: 'Chainrunner', minScore: 50, column: 1, row: 0 },
	{ name: 'Grindknight', minScore: 150, column: 0, row: 1 },
	{ name: 'Grindion', minScore: 300, column: 1, row: 1 }
] as const;

export function heroFormForScore(score: number) {
	return HERO_FORMS.findLast((form) => score >= form.minScore) ?? HERO_FORMS[0];
}

export function nextHeroFormForScore(score: number) {
	return HERO_FORMS.find((form) => form.minScore > score);
}
