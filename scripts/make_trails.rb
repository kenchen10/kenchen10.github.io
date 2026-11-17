#!/usr/bin/env ruby
# Turns hiking routes (GPX files in trails/) into compact trail data for album pages.
#
#   ruby scripts/make_trails.rb
#
# For each trails/<name>.gpx it writes _data/trails/<name>.json with a simplified
# route (enough points to draw it smoothly) plus distance and elevation stats.
# Show it on an album by adding `trail: <name>` to that album in _data/images.yml.
# Works with GPX exports from AllTrails, Strava, Garmin, etc. Uses only Ruby's standard library.

require 'rexml/document'
require 'json'

ROOT = File.expand_path('..', __dir__)
Dir.chdir(ROOT)

R = 6_371_000.0
def haversine(a, b)
  la1, lo1, la2, lo2 = [a[0], a[1], b[0], b[1]].map { |d| d * Math::PI / 180 }
  h = Math.sin((la2 - la1) / 2)**2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2)**2
  2 * R * Math.asin(Math.sqrt(h))
end

# Douglas-Peucker simplification on a local flat projection (metres)
def simplify(pts, tol)
  return pts if pts.size < 3
  lat0 = pts.sum { |p| p[0] } / pts.size * Math::PI / 180
  xy = pts.map { |p| [p[1] * Math::PI / 180 * R * Math.cos(lat0), p[0] * Math::PI / 180 * R] }
  keep = Array.new(pts.size, false)
  keep[0] = keep[-1] = true
  stack = [[0, pts.size - 1]]
  until stack.empty?
    i, j = stack.pop
    ax, ay = xy[i]; bx, by = xy[j]
    dx, dy = bx - ax, by - ay
    len = Math.hypot(dx, dy)
    best, idx = 0, nil
    (i + 1...j).each do |k|
      px, py = xy[k]
      d = len.zero? ? Math.hypot(px - ax, py - ay) : ((px - ax) * dy - (py - ay) * dx).abs / len
      best, idx = d, k if d > best
    end
    next unless idx && best > tol
    keep[idx] = true
    stack << [i, idx] << [idx, j]
  end
  pts.each_index.select { |k| keep[k] }.map { |k| pts[k] }
end

Dir['trails/*.gpx'].sort.each do |gpx|
  name = File.basename(gpx, '.gpx')
  doc = REXML::Document.new(File.read(gpx))
  pts = []
  doc.elements.each('//trkpt | //rtept') do |pt|
    ele = pt.elements['ele']&.text
    pts << [pt.attributes['lat'].to_f, pt.attributes['lon'].to_f, ele ? ele.to_f : nil]
  end
  next warn("#{gpx}: no points") if pts.empty?
  title = doc.elements['//trk/name']&.text || doc.elements['//metadata/name']&.text || name

  # Distance along the full route, and ascent/descent with a 3 m threshold to ignore noise
  dist = [0.0]
  pts.each_cons(2) { |a, b| dist << dist.last + haversine(a, b) }
  gain = loss = 0.0
  ref = pts.first[2]
  pts.each do |p|
    next unless p[2] && ref
    d = p[2] - ref
    if d.abs >= 3
      d > 0 ? gain += d : loss -= d
      ref = p[2]
    end
  end
  eles = pts.map { |p| p[2] }.compact

  with_dist = pts.each_with_index.map { |p, i| p + [dist[i]] }
  slim = simplify(with_dist, 2.5)
  data = {
    name: title.strip,
    distance_km: (dist.last / 1000).round(2),
    ascent_m: gain.round,
    descent_m: loss.round,
    max_ele_m: eles.max&.round,
    min_ele_m: eles.min&.round,
    # [lon, lat, elevation m, distance km]
    points: slim.map { |lat, lon, ele, d| [lon.round(5), lat.round(5), ele&.round(1), (d / 1000).round(3)] },
  }
  File.write("_data/trails/#{name}.json", JSON.generate(data))
  puts "#{name}: #{pts.size} -> #{slim.size} points, #{data[:distance_km]} km, +#{data[:ascent_m]} m / -#{data[:descent_m]} m"
end
