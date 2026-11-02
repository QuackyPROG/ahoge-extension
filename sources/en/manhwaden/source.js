source = Madara({
  baseUrl: META.baseUrl,
  filterNonMangaItems: false,
  // Chapters are plain <img> tags in the post body, without page-break wrappers.
  pageSelector: ".reading-content img",
});
