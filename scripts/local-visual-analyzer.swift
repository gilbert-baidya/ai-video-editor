import AppKit
import Foundation
import Vision

struct InputSample: Codable {
    let beatId: String
    let time: Double
    let imagePath: String
}

struct Region: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let confidence: Double
    let classification: String?
    let kind: String?
}

struct Analysis: Codable {
    let beatId: String
    let time: Double
    let imagePath: String
    let width: Int
    let height: Int
    let faces: [Region]
    let subject: Region?
    let occupied: [Region]
    let detector: String
}

func normalized(_ box: CGRect) -> Region {
    let y = 1.0 - box.origin.y - box.height
    return Region(x: Double(box.origin.x), y: Double(y), width: Double(box.width), height: Double(box.height), confidence: 0, classification: nil, kind: nil)
}

func classify(_ center: Double) -> String {
    if center < 0.38 { return "left" }
    if center > 0.62 { return "right" }
    return "center"
}

func analyze(_ sample: InputSample) throws -> Analysis {
    let url = URL(fileURLWithPath: sample.imagePath)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw NSError(domain: "VisualAnalyzer", code: 1) }
    let width = image.width
    let height = image.height
    var faceRequest: VNDetectFaceRectanglesRequest!
    var rectangleRequest: VNDetectRectanglesRequest!
    var bodyRequest: VNDetectHumanBodyPoseRequest!
    faceRequest = VNDetectFaceRectanglesRequest()
    faceRequest.revision = VNDetectFaceRectanglesRequestRevision3
    faceRequest.preferBackgroundProcessing = true
    rectangleRequest = VNDetectRectanglesRequest()
    rectangleRequest.minimumConfidence = 0.35
    rectangleRequest.maximumObservations = 8
    rectangleRequest.minimumAspectRatio = 0.35
    rectangleRequest.maximumAspectRatio = 3.2
    rectangleRequest.minimumSize = 0.12
    rectangleRequest.quadratureTolerance = 20
    rectangleRequest.preferBackgroundProcessing = true
    bodyRequest = VNDetectHumanBodyPoseRequest()
    bodyRequest.preferBackgroundProcessing = true
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([faceRequest, rectangleRequest, bodyRequest])
    let faceObservations = (faceRequest.results as? [VNFaceObservation]) ?? []
    let faces = faceObservations.map { observation in
        let box = normalized(observation.boundingBox)
        return Region(x: box.x, y: box.y, width: box.width, height: box.height, confidence: Double(observation.confidence), classification: nil, kind: "face")
    }
    let bodyRegions = ((bodyRequest.results as? [VNHumanBodyPoseObservation]) ?? []).compactMap { observation -> Region? in
        guard let points = try? observation.recognizedPoints(.all) else { return nil }
        let valid = points.values.filter { $0.confidence > 0.25 }
        guard !valid.isEmpty else { return nil }
        let minX = valid.map { Double($0.location.x) }.min() ?? 0
        let minY = valid.map { 1.0 - Double($0.location.y) }.min() ?? 0
        let maxX = valid.map { Double($0.location.x) }.max() ?? 1
        let maxY = valid.map { 1.0 - Double($0.location.y) }.max() ?? 1
        return Region(x: minX, y: minY, width: maxX - minX, height: maxY - minY, confidence: Double(observation.confidence), classification: classify((minX + maxX) / 2), kind: "subject")
    }.sorted { ($0.width * $0.height) > ($1.width * $1.height) }
    let subject: Region? = {
        if !faces.isEmpty {
            return subjectFromFaces(faces)
        }
        return bodyRegions.first
    }()
    func subjectFromFaces(_ faces: [Region]) -> Region {
        let first = faces[0]
        let minX = faces.map(\.x).min() ?? first.x
        let minY = faces.map(\.y).min() ?? first.y
        let maxX = faces.map { $0.x + $0.width }.max() ?? first.x + first.width
        let maxY = faces.map { $0.y + $0.height }.max() ?? first.y + first.height
        let expandedX = max(0, minX - 0.16)
        let expandedY = max(0, minY - 0.30)
        let expandedMaxX = min(1, maxX + 0.16)
        let expandedMaxY = min(1, maxY + 0.38)
        return Region(x: expandedX, y: expandedY, width: expandedMaxX - expandedX, height: expandedMaxY - expandedY, confidence: min(0.99, first.confidence + 0.05), classification: classify((minX + maxX) / 2), kind: "subject")
    }
    let occupied = ((rectangleRequest.results as? [VNRectangleObservation]) ?? []).compactMap { observation -> Region? in
        let box = normalized(observation.boundingBox)
        let area = box.width * box.height
        guard area >= 0.12 else { return nil }
        let center = box.x + box.width / 2
        let kind = box.width / max(box.height, 0.01) > 1.3 ? "screen" : "existing-graphic"
        return Region(x: box.x, y: box.y, width: box.width, height: box.height, confidence: Double(observation.confidence), classification: classify(center), kind: kind)
    }
    return Analysis(beatId: sample.beatId, time: sample.time, imagePath: sample.imagePath, width: width, height: height, faces: faces, subject: subject, occupied: occupied, detector: "macOS Vision face rectangles + body pose + rectangle occupancy")
}

let input = CommandLine.arguments.dropFirst()
guard let inputPath = input.first, let outputPath = input.dropFirst().first else { exit(2) }
let data = try Data(contentsOf: URL(fileURLWithPath: inputPath))
let samples = try JSONDecoder().decode([InputSample].self, from: data)
let analyses = try samples.map(analyze)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
try encoder.encode(analyses).write(to: URL(fileURLWithPath: outputPath))
