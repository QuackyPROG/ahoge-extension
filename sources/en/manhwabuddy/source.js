const yii = Yiimanga({ baseUrl: META.baseUrl });

// The site has no sortable catalogue; its homepage carousel is the popular list.
yii.popular = async () => {
  const res = ensureOk(await http.get(META.baseUrl + "/", { headers: { Referer: META.baseUrl + "/" } }));
  const doc = html.parse(res.body, res.url);
  const manga = doc
    .select(".item-move")
    .map((el) => {
      const link = el.selectFirst(".name a");
      return link ? { url: pathOf(link.absUrl("href")), title: link.text(), cover: imageUrl(el.selectFirst("img")) } : null;
    })
    .filter(Boolean);
  return { manga, hasNextPage: false };
};

source = yii;
