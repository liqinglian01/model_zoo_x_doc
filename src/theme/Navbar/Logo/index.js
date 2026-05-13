import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {useThemeConfig} from '@docusaurus/theme-common';
import ThemedImage from '@theme/ThemedImage';

function LogoThemedImage({logo, alt, imageClassName}) {
  const sources = {
    light: useBaseUrl(logo.src),
    dark: useBaseUrl(logo.srcDark || logo.src),
  };
  const themedImage = (
    <ThemedImage
      className={logo.className}
      sources={sources}
      height={logo.height}
      width={logo.width}
      alt={alt}
      style={logo.style}
    />
  );

  return imageClassName ? (
    <div className={imageClassName}>{themedImage}</div>
  ) : (
    themedImage
  );
}

export default function NavbarLogo() {
  const { i18n } = useDocusaurusContext();
  const isEnglish = i18n.currentLocale === 'en';
  const {
    navbar: {logo},
  } = useThemeConfig();

  const title = isEnglish ? 'RDK Docs' : 'RDK 文档';

  const fallbackAlt = logo?.alt ?? title;
  const alt = logo?.alt ?? fallbackAlt;

  // 使用文档站点首页（自动包含 baseUrl 与当前语言前缀）。勿写死 /rdk_doc_filter/ 等路径，否则会 404。
  return (
    <Link to="/" className="navbar__brand">
      {logo && (
        <LogoThemedImage
          logo={logo}
          alt={alt}
          imageClassName="navbar__logo"
        />
      )}
      <b className="navbar__title text--truncate">{title}</b>
    </Link>
  );
}
