import React, { useEffect, useLayoutEffect, useMemo } from "react";
import { useHistory, useLocation } from "@docusaurus/router";
import { useDocsSidebar } from "@docusaurus/plugin-content-docs/client";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import useBaseUrl from "@docusaurus/useBaseUrl";
import DocItem from "@theme-original/DocItem";
import DocScopeHydration from "@site/src/components/DocScopeHydration";
import SearchHighlight from "@site/src/components/SearchHighlight";
import GiscusComments from "./GiscusComments";
import { useDocScopeFilter } from "@site/src/context/DocScopeFilterContext";
import { shouldShowDoc, findFirstVisibleDoc } from "@site/src/context/sidebar-scope-config";
import { isMultiInstanceDocsRoute } from "@site/src/utils/docs-route-utils";
import {
  flattenSingleChildCategories,
  findDocDisplayNumber,
  renumberVisibleItems,
  stripNumberPrefix,
} from "@site/src/utils/sidebar-numbering";

function filterItems(items, version, product) {
  if (!Array.isArray(items)) return items;
  const result = [];
  for (const item of items) {
    if (item.type === "category" && item.items) {
      const filtered = filterItems(item.items, version, product);
      if (filtered.length > 0) {
        result.push({ ...item, items: filtered });
      }
      continue;
    }
    if (shouldShowDoc(item.docId || "", version, product)) {
      result.push(item);
    }
  }
  return result;
}

export default function DocItemWrapper(props) {
  const { siteConfig, i18n } = useDocusaurusContext();
  const { version, product } = useDocScopeFilter();
  const history = useHistory();
  const location = useLocation();
  const sidebar = useDocsSidebar();
  const homeUrl = useBaseUrl("/");

  const docId = props?.content?.metadata?.id || "";

  const skipSidebarScope = isMultiInstanceDocsRoute(
    location.pathname,
    siteConfig.baseUrl,
    i18n.currentLocale,
    i18n.defaultLocale,
  );

  const visible = skipSidebarScope || shouldShowDoc(docId, version, product);
  const filteredRenumberedSidebar = useMemo(() => {
    if (!sidebar?.items || skipSidebarScope) return null;
    const filtered = filterItems(sidebar.items, version, product);
    const flattened = flattenSingleChildCategories(filtered);
    return renumberVisibleItems(flattened);
  }, [sidebar, skipSidebarScope, version, product]);
  const currentDocDisplayNumber = useMemo(() => {
    if (!filteredRenumberedSidebar) return null;
    return findDocDisplayNumber(filteredRenumberedSidebar, docId);
  }, [filteredRenumberedSidebar, docId]);

  useEffect(() => {
    if (skipSidebarScope || visible || !sidebar?.items) {
      return;
    }
    const firstDocHref = findFirstVisibleDoc(sidebar.items, version, product);
    if (firstDocHref) {
      const currentSearch = window.location.search;
      history.replace(firstDocHref + currentSearch);
    } else {
      history.replace(`${homeUrl}${location.search}${location.hash}`);
    }
  }, [visible, history, sidebar, skipSidebarScope, homeUrl, location.search, location.hash]);

  useLayoutEffect(() => {
    if (!visible || skipSidebarScope || !currentDocDisplayNumber) {
      return;
    }
    const root =
      typeof document !== "undefined"
        ? document.querySelector(".theme-doc-markdown") ||
          document.querySelector("article.markdown") ||
          document.querySelector("article")
        : null;
    const h1 = root?.querySelector("h1");
    if (!h1) return;

    const rawTitle = (h1.textContent || "").trim();
    if (!rawTitle) return;
    const plainTitle = stripNumberPrefix(rawTitle).trim();
    if (!plainTitle) return;

    const nextTitle = `${currentDocDisplayNumber} ${plainTitle}`;
    if (rawTitle !== nextTitle) {
      h1.textContent = nextTitle;
    }
  }, [visible, skipSidebarScope, currentDocDisplayNumber, docId]);

  if (!visible) {
    return null;
  }

  return (
    <>
      <DocScopeHydration />
      <SearchHighlight />
      <DocItem {...props} />
      <GiscusComments />
    </>
  );
}
