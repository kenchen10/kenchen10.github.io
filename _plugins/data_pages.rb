# Builds a page for every entry in the data files below, so a new album or paper
# needs only its YAML entry, not a folder with an empty index.html.
#
#   _data/images.yml                      -> /photos/<id>/   (layout: photos)
#   _data/publications.yml, otherpubs.yml -> /projects/<id>/ (layout: publication_new)
#
# A real file at the same URL (e.g. projects/sig25/index.html, which has its own
# content) wins and is left alone. Custom plugins don't run on GitHub Pages' classic
# build, so the site deploys through .github/workflows/pages.yml.
module DataPages
  SOURCES = [
    { data: %w[images], dir: "photos", layout: "photos" },
    { data: %w[publications otherpubs], dir: "projects", layout: "publication_new" },
  ].freeze

  class Generator < Jekyll::Generator
    safe true

    def generate(site)
      taken = site.pages.map(&:url).to_h { |url| [url, true] }

      SOURCES.each do |source|
        source[:data].flat_map { |name| Array(site.data[name]) }.each do |entry|
          id = entry.is_a?(Hash) && entry["id"]
          next unless id

          page = Jekyll::PageWithoutAFile.new(site, site.source, File.join(source[:dir], id.to_s), "index.html")
          next if taken[page.url]

          page.data["layout"] = source[:layout]
          page.data["id"] = id
          site.pages << page
          taken[page.url] = true
        end
      end
    end
  end
end
