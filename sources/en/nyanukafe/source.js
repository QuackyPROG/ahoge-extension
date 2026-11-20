source = Keyoapp({
  baseUrl: META.baseUrl,
  popularSelector: ".series-splide .splide__slide:not(.splide__slide--clone)",
  statusSelector: "div.w-full.flex-wrap > div:nth-child(4) > div:last-child",
  authorSelector: "div.w-full.flex-wrap > div:nth-child(1) > div:last-child",
  artistSelector: "div.w-full.flex-wrap > div:nth-child(2) > div:last-child",
  typeSelector: "div.w-full.flex-wrap > div:nth-child(3) > div:last-child",
});
