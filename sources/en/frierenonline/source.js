source = Madara({
  baseUrl: META.baseUrl,
  chapterMode: "mangaPage",
  titleSelector: ".about h1",
  statusSelector: "h5:contains(Status) + h4",
  thumbnailSelector: ".cover_managa img",
  descriptionSelector: ".synopsis",
  authorSelector: "h5:contains(Author) + h4",
  artistSelector: "h5:contains(Artist) + h4",
  genreSelector: ".tags a[rel=tag]",
});
