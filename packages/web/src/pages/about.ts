import { O200K_INFO, VERSION } from '@repr-werkbank/core';
import { el } from '../dom.ts';
import { t } from '../i18n.ts';
import { externalLink, fileLink } from '../links.ts';
import { hrefOf } from '../router.ts';
import { pageFrame, section } from './page.ts';

/** Year of the citation hint; the release year of the version, kept with the version (FA-82). */
export const CITATION_YEAR = 2026;

/** The citation hint for the tool as plain text (also used by the tests). */
export function citationText(): string {
  return `Rybinski, F. (${CITATION_YEAR}). repr-werkbank (version ${VERSION}) [Computer software]. Karlsruhe Institute of Technology.`;
}

/** About (FA-80): purpose, the publication, how to cite, version, repository, the note of 5.3, tokenizer, privacy, licences. */
export function renderAbout(): HTMLElement {
  const para = (...parts: (Node | string)[]): HTMLElement => el('p', {}, ...parts);
  return pageFrame(
    t('about.title'),
    section(t('about.purposeTitle'), t('about.purpose')),
    section(
      t('about.publicationTitle'),
      para(t('about.publication'), ' ', externalLink('doi', t('about.doiText')), '.'),
      para(t('about.venue')),
    ),
    section(t('about.verbalizationTitle'), t('about.verbalization')),
    section(t('about.tokenizerTitle'), t('about.tokenizer', { name: O200K_INFO.name, implementation: O200K_INFO.implementation })),
    section(
      t('about.citeTitle'),
      para(t('about.cite')),
      el('p', { class: 'citation' }, citationText(), ' ', externalLink('repository', t('about.repositoryText'))),
      para(t('about.citeFile'), ' ', externalLink('citation', 'CITATION.cff'), '.'),
    ),
    section(
      t('about.versionTitle'),
      para(t('about.version', { version: VERSION })),
      para(t('about.author')),
      para(t('about.repository'), ' ', externalLink('repository', t('about.repositoryText')), '.'),
    ),
    section(t('about.privacyTitle'), t('about.privacy')),
    section(
      t('about.licenseTitle'),
      para(t('about.license'), ' ', externalLink('licenseMit', 'MIT'), ', ', externalLink('licenseCcBy', 'CC BY 4.0'), '.'),
      para(t('about.thirdParty'), ' ', fileLink('./THIRD_PARTY_LICENSES.txt', 'THIRD_PARTY_LICENSES.txt'), '.'),
      para(el('a', { href: hrefOf('legal') }, t('about.legalLink'))),
    ),
  );
}
