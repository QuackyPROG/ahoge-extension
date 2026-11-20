source = Keyoapp({
  baseUrl: META.baseUrl,
  altNameSelector: "div.font-medium:containsOwn(Alternative titles) ~ div span.select-all",
  statusSelector: "div[alt=Status]",
  authorSelector: "div[alt=Author]",
  artistSelector: "div[alt=Artist]",
  typeSelector: "div[alt='Series Type']",
});
