source = Madara({
  baseUrl: META.baseUrl,
  chapterMode: "mangaPage",
  titleSelector: "h1",
  statusSelector: "h5:contains(Status) + h4",
  thumbnailSelector: ".cover_managa img",
  descriptionSelector: ".synopsis p",
  authorSelector: "h5:contains(Author) + h4 a",
  artistSelector: "h5:contains(Artist) + h4 a",
});
