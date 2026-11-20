source = Keyoapp({
  baseUrl: META.baseUrl,
  layout: "livewire",
  altNameSelector: "details[data-testid=series-other-names] li.select-all",
  statusSelector: "a[aria-label=Status]",
  typeSelector: "a[aria-label=Type]",
  genreSelector: "div:has(>h1) a[href*='/genres/']",
  authorSelector: "dt:contains(Author) + dd",
  artistSelector: "dt:contains(Artist) + dd",
  paidChapterSelector: "img[alt~=Coin], img[src*=star-circle]",
});
