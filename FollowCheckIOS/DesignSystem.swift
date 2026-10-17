import SwiftUI
import UIKit

// FollowCheck design system: warm ink and paper surfaces, one signal colour
// for the primary action and growth, coral for losses, blue for one-way reach.
// Every colour adapts to light and dark appearance.

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }
    static func adaptive(_ light: UInt32, _ dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) -> UIColor {
        UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark, alpha: darkAlpha) : UIColor(hex: light, alpha: lightAlpha)
        }
    }
}

enum Theme {
    static let canvas = Color(uiColor: .adaptive(0xF3F1EA, 0x0D0E0B))
    static let surface = Color(uiColor: .adaptive(0xFFFFFF, 0x171914))
    static let raised = Color(uiColor: .adaptive(0xF7F6F0, 0x20231C))
    static let sunken = Color(uiColor: .adaptive(0xE7E5DC, 0x262921))
    static let line = Color(uiColor: .adaptive(0x000000, 0xFFFFFF, lightAlpha: 0.08, darkAlpha: 0.08))
    static let lineStrong = Color(uiColor: .adaptive(0x000000, 0xFFFFFF, lightAlpha: 0.16, darkAlpha: 0.16))
    static let ink = Color(uiColor: .adaptive(0x15170F, 0xF1F0E8))
    static let ink2 = Color(uiColor: .adaptive(0x5A5C53, 0xA6A89D))
    static let ink3 = Color(uiColor: .adaptive(0x85877D, 0x74776C))
    /// Fill for the primary action and highlighted states. Text on it uses `onSignal`.
    static let signal = Color(uiColor: .adaptive(0xC2EC55, 0xC8F560))
    static let onSignal = Color(uiColor: UIColor(hex: 0x14160E))
    /// Signal colour for text and icons, legible on canvas and surfaces.
    static let signalInk = Color(uiColor: .adaptive(0x3B6600, 0xC8F560))
    static let loss = Color(uiColor: .adaptive(0xC03A20, 0xFF7C5C))
    static let reach = Color(uiColor: .adaptive(0x2E5CC2, 0x8DB6FF))
    static let caution = Color(uiColor: .adaptive(0x965800, 0xF2B544))
    static let webBackground = UIColor.adaptive(0xF3F1EA, 0x0D0E0B)
}

enum Tone {
    case gain, loss, reach, caution, neutral, signal
    var color: Color {
        switch self {
        case .gain, .signal: return Theme.signalInk
        case .loss: return Theme.loss
        case .reach: return Theme.reach
        case .caution: return Theme.caution
        case .neutral: return Theme.ink2
        }
    }
}

// Compatibility facade for screens that still reference the original style names.
enum FCStyle {
    static let background = Theme.canvas
    static let card = Theme.surface
    static let accent = Theme.signalInk
    static let mint = Theme.signalInk
    static let pink = Theme.loss
    static let gradient = LinearGradient(colors: [Theme.signal, Theme.signal], startPoint: .leading, endPoint: .trailing)
}

// MARK: - Surfaces

struct SurfaceModifier: ViewModifier {
    var padding: CGFloat
    var radius: CGFloat
    var fill: Color
    func body(content: Content) -> some View {
        content.padding(padding)
            .background(fill, in: .rect(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Theme.line))
    }
}

extension View {
    func surface(padding: CGFloat = 16, radius: CGFloat = 20, fill: Color = Theme.surface) -> some View {
        modifier(SurfaceModifier(padding: padding, radius: radius, fill: fill))
    }
    func fcCard() -> some View { surface() }
    /// Grouped forms on the brand canvas.
    func fcForm() -> some View {
        scrollContentBackground(.hidden).background(Theme.canvas)
    }
}

// MARK: - Buttons

struct PressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(reduceMotion ? nil : .spring(response: 0.25), value: configuration.isPressed)
    }
}

/// Full-width primary action.
struct SignalButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(enabled ? Theme.onSignal : Theme.ink3)
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(enabled ? Theme.signal : Theme.sunken, in: .rect(cornerRadius: 18, style: .continuous))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(reduceMotion ? nil : .spring(response: 0.25), value: configuration.isPressed)
    }
}

/// Compact primary action that hugs its label.
struct ProminentButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(enabled ? Theme.onSignal : Theme.ink3)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(enabled ? Theme.signal : Theme.sunken, in: .rect(cornerRadius: 14, style: .continuous))
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

/// Secondary action on a quiet surface.
struct QuietButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    var fill = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(enabled ? Theme.ink : Theme.ink3)
            .padding(.horizontal, 16)
            .frame(maxWidth: fill ? .infinity : nil, minHeight: 44)
            .background(Theme.raised, in: .rect(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.line))
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}

struct IconGlyph: View {
    let systemName: String
    var tint: Color = Theme.ink
    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: 44, height: 44)
            .background(Theme.surface, in: .circle)
            .overlay(Circle().strokeBorder(Theme.line))
    }
}

struct IconButton: View {
    let systemName: String
    let label: String
    var tint: Color = Theme.ink
    let action: () -> Void
    var body: some View {
        Button(action: action) { IconGlyph(systemName: systemName, tint: tint) }
            .buttonStyle(PressStyle())
            .accessibilityLabel(label)
    }
}

// MARK: - Typography and layout

struct ScreenHeader<Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var trailing: () -> Trailing
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.largeTitle.weight(.bold)).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle).font(.subheadline).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: 8) { trailing() }
        }
    }
}

extension ScreenHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.init(title: title, subtitle: subtitle) { EmptyView() }
    }
}

struct SectionHeader: View {
    let title: String
    var action: String? = nil
    var perform: (() -> Void)? = nil
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.title3.weight(.semibold)).foregroundStyle(Theme.ink).accessibilityAddTraits(.isHeader)
            Spacer()
            if let action, let perform {
                Button(action, action: perform).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.signalInk)
            }
        }
    }
}

struct Eyebrow: View {
    let text: String
    var tone: Color = Theme.ink2
    var body: some View {
        Text(text.uppercased()).font(.caption.weight(.semibold)).tracking(0.8).foregroundStyle(tone)
    }
}

// MARK: - Status

struct StatusPill: View {
    let text: String
    var tone: Tone = .neutral
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(tone.color).frame(width: 7, height: 7)
            Text(text).font(.caption.weight(.semibold)).foregroundStyle(tone == .neutral ? Theme.ink2 : tone.color)
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(tone.color.opacity(0.12), in: .capsule)
        .accessibilityElement(children: .combine)
    }
}

struct Chip: View {
    let title: String
    var count: Int? = nil
    let selected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title)
                if let count {
                    Text(count.formatted()).monospacedDigit()
                        .foregroundStyle(selected ? Theme.onSignal.opacity(0.65) : Theme.ink3)
                }
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 14)
            .frame(minHeight: 38)
            .foregroundStyle(selected ? Theme.onSignal : Theme.ink)
            .background(selected ? Theme.signal : Theme.surface, in: .capsule)
            .overlay(Capsule().strokeBorder(selected ? Color.clear : Theme.line))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct ChipRow<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) { content() }.padding(.horizontal, 20)
        }
        .padding(.horizontal, -20)
    }
}

struct SearchField: View {
    @Binding var text: String
    var prompt: String
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.ink3)
            TextField(prompt, text: $text)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .foregroundStyle(Theme.ink)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.ink3) }
                    .buttonStyle(.plain).accessibilityLabel("Limpar pesquisa")
            }
        }
        .font(.body)
        .padding(.horizontal, 14).frame(minHeight: 46)
        .background(Theme.surface, in: .rect(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.line))
    }
}

struct EmptyState: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: icon).font(.system(size: 26, weight: .medium)).foregroundStyle(Theme.signalInk)
                .frame(width: 64, height: 64).background(Theme.signal.opacity(0.16), in: .circle)
            VStack(spacing: 6) {
                Text(title).font(.headline).foregroundStyle(Theme.ink)
                Text(message).font(.subheadline).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(ProminentButtonStyle())
            }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 28).padding(.horizontal, 20)
        .accessibilityElement(children: .contain)
    }
}

struct InlineNotice: View {
    let text: String
    var tone: Tone = .caution
    var icon = "exclamationmark.triangle.fill"
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).foregroundStyle(tone.color).padding(.top, 1)
            Text(text).font(.footnote).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(tone.color.opacity(0.1), in: .rect(cornerRadius: 14, style: .continuous))
    }
}

// MARK: - People

struct ProfileAvatar: View {
    let photoURL: String
    var size: CGFloat = 40
    var name: String = ""
    var body: some View {
        AsyncImage(url: URL(string: photoURL).flatMap { $0.scheme == "https" ? $0 : nil }) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                ZStack {
                    Theme.sunken
                    if let initial = name.trimmingCharacters(in: CharacterSet(charactersIn: "@._ ")).first {
                        Text(String(initial).uppercased()).font(.system(size: size * 0.4, weight: .semibold, design: .rounded)).foregroundStyle(Theme.ink2)
                    } else {
                        Image(systemName: "person.fill").font(.system(size: size * 0.42)).foregroundStyle(Theme.ink3)
                    }
                }
            }
        }
        .frame(width: size, height: size).clipShape(Circle())
        .overlay(Circle().strokeBorder(Theme.line))
        .accessibilityHidden(true)
    }
}

enum RelationKind {
    case mutual, notFollowingBack, notFollowed, none
    init(_ person: AppModel.Relation) {
        if person.follows && person.following { self = .mutual }
        else if person.following { self = .notFollowingBack }
        else if person.follows { self = .notFollowed }
        else { self = .none }
    }
    var label: String {
        switch self {
        case .mutual: return "Mútuo"
        case .notFollowingBack: return "Não te segue"
        case .notFollowed: return "Não segues"
        case .none: return "Sem ligação"
        }
    }
    var tone: Tone {
        switch self {
        case .mutual: return .gain
        case .notFollowingBack: return .loss
        case .notFollowed: return .reach
        case .none: return .neutral
        }
    }
}

struct RelationBadge: View {
    let kind: RelationKind
    var body: some View {
        Text(kind.label).font(.caption2.weight(.semibold)).foregroundStyle(kind.tone.color)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(kind.tone.color.opacity(0.12), in: .capsule)
    }
}

/// The relation filters keep their original keys; the labels address the user directly.
enum RelationFilter {
    static func label(_ key: String) -> String {
        switch key {
        case "Não me seguem": return "Não te seguem"
        case "Eu não sigo": return "Não segues"
        default: return key
        }
    }
    static func explanation(_ key: String) -> String {
        switch key {
        case "Não me seguem": return "Contas que segues e que não te seguem de volta."
        case "Eu não sigo": return "Contas que te seguem e que tu não segues."
        case "Mútuos": return "Seguem-se nos dois sentidos."
        case "Seguidores": return "Todas as contas que te seguem."
        case "A seguir": return "Todas as contas que segues."
        default: return "Todas as contas do último check completo."
        }
    }
}

// MARK: - Signature: the reciprocity ring

struct RingSegment: Identifiable {
    let id: String
    let value: Double
    let color: Color
}

/// A ring split by relationship type. While a check runs it becomes a progress ring.
struct ReciprocityRing<Center: View>: View {
    let segments: [RingSegment]
    var running = false
    var progress: Double? = nil
    var lineWidth: CGFloat = 16
    @ViewBuilder var center: () -> Center
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var drawn = false

    private struct Arc: Identifiable {
        let id: String
        let color: Color
        let from: Double
        let to: Double
    }

    private var arcs: [Arc] {
        let visible = segments.filter { $0.value > 0 }
        let total = visible.reduce(0.0) { $0 + $1.value }
        guard total > 0 else { return [] }
        let gap = visible.count > 1 ? 0.006 : 0.0
        var result: [Arc] = []
        var start = 0.0
        for segment in visible {
            let span = segment.value / total
            result.append(Arc(id: segment.id, color: segment.color, from: start + gap, to: max(start + gap, start + span - gap)))
            start += span
        }
        return result
    }

    var body: some View {
        ZStack {
            Circle().stroke(Theme.sunken, lineWidth: lineWidth)
            if running {
                if let progress {
                    Circle().trim(from: 0, to: max(0.02, min(1, progress)))
                        .stroke(Theme.signal, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.6), value: progress)
                } else {
                    TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion || scenePhase != .active)) { context in
                        let turn = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.4) / 2.4
                        Circle().trim(from: 0, to: 0.22)
                            .stroke(Theme.signal, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                            .rotationEffect(.degrees(turn * 360 - 90))
                    }
                }
            } else {
                ForEach(arcs) { arc in
                    Circle().trim(from: arc.from, to: drawn ? arc.to : arc.from)
                        .stroke(arc.color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .butt))
                        .rotationEffect(.degrees(-90))
                }
            }
            center().padding(lineWidth + 12)
        }
        .aspectRatio(1, contentMode: .fit)
        .onAppear {
            if reduceMotion { drawn = true } else { withAnimation(.easeOut(duration: 0.9).delay(0.1)) { drawn = true } }
        }
    }
}

// MARK: - Brand mark

/// Two overlapping circles, you and them; the shared lens (mutual) carries the signal colour.
/// Matches the app icon.
struct BrandMark: View {
    var size: CGFloat = 28
    var body: some View {
        let diameter = size * 0.62
        let offset = size * 0.17
        let line = max(1.5, size * 0.085)
        ZStack {
            Circle().fill(Theme.signal).frame(width: diameter, height: diameter).offset(x: -offset)
                .mask(Circle().frame(width: diameter, height: diameter).offset(x: offset))
            Circle().stroke(Theme.ink, lineWidth: line).frame(width: diameter, height: diameter).offset(x: -offset)
            Circle().stroke(Theme.ink, lineWidth: line).frame(width: diameter, height: diameter).offset(x: offset)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// MARK: - Toast

struct NoticeToast: View {
    let text: String
    let dismiss: () -> Void
    var body: some View {
        Button(action: dismiss) {
            HStack(alignment: .top, spacing: 12) {
                BrandMark(size: 20).padding(.top, 1)
                Text(text).font(.subheadline).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                    .lineLimit(6).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(Theme.ink3).padding(.top, 3)
            }
            .padding(16)
            .background(Theme.surface, in: .rect(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.lineStrong))
            .shadow(color: .black.opacity(0.18), radius: 24, y: 10)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(text)
        .accessibilityHint("Toca para fechar")
        .padding(.horizontal, 16)
    }
}

enum RelativeTime {
    static func short(_ date: Date) -> String {
        date.formatted(.relative(presentation: .named, unitsStyle: .wide))
    }
    static func interval(_ minutes: Int) -> String {
        switch minutes {
        case ..<60: return "\(minutes) min"
        case ..<1440: return "\(minutes / 60) h"
        case 1440: return "1 dia"
        default: return minutes % 1440 == 0 ? "\(minutes / 1440) dias" : "\(minutes / 60) h"
        }
    }
}

extension ISO8601DateFormatter {
    /// Shared parser for the engine's timestamps with fractional seconds.
    static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
