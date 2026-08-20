// Package runtime provides JavaScript semantics used by emitted Go programs.
package runtime

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf16"
)

// Argv returns a Node-shaped argv while preserving user arguments from os.Args.
func Argv(entryFile string) []string {
	executable, err := os.Executable()
	if err != nil {
		panic(err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		panic(err)
	}
	return append([]string{executable, entryFile}, os.Args[1:]...)
}

type undefined struct{}

func Index(values []string, index float64) any {
	if index < 0 || index >= float64(len(values)) || index != math.Trunc(index) {
		return undefined{}
	}
	return values[int(index)]
}

func IndexLength(values []string, index float64) float64 {
	if index < 0 || index >= float64(len(values)) || index != math.Trunc(index) {
		fmt.Fprintln(os.Stderr, "TypeError: Cannot read properties of undefined (reading 'length')")
		os.Exit(1)
	}
	return Length(values[int(index)])
}

func Slice(values []string, start float64) []string {
	if math.IsNaN(start) {
		start = 0
	}
	start = math.Trunc(start)
	if start < 0 {
		start = math.Max(float64(len(values))+start, 0)
	} else {
		start = math.Min(start, float64(len(values)))
	}
	return values[int(start):]
}

func Exit(code float64) {
	if math.IsNaN(code) || math.IsInf(code, 0) || code != math.Trunc(code) || math.Abs(code) > 9007199254740991 {
		fmt.Fprintf(os.Stderr, "RangeError: process.exit code must be an integer. Received %s\n", numberString(code))
		os.Exit(1)
	}
	os.Exit(int(code))
}

func Length(value any) float64 {
	switch value := value.(type) {
	case string:
		return float64(len(utf16.Encode([]rune(value))))
	case []string:
		return float64(len(value))
	case undefined:
		fmt.Fprintln(os.Stderr, "TypeError: Cannot read properties of undefined (reading 'length')")
		os.Exit(1)
		return 0
	default:
		panic(fmt.Sprintf("unsupported JavaScript length for %T", value))
	}
}

func Log(values ...any) {
	for index, value := range values {
		if index > 0 {
			fmt.Print(" ")
		}
		switch value := value.(type) {
		case float64:
			if value == 0 && math.Signbit(value) {
				fmt.Print("-0")
			} else {
				fmt.Print(String(value))
			}
		case []string:
			fmt.Print(inspectStringArray(value))
		default:
			fmt.Print(String(value))
		}
	}
	fmt.Println()
}

func Infinity() float64 {
	return math.Inf(1)
}

func Add(left, right any) any {
	if values, ok := left.([]string); ok {
		left = String(values)
	}
	if values, ok := right.([]string); ok {
		right = String(values)
	}
	if _, ok := left.(string); ok {
		return String(left) + String(right)
	}
	if _, ok := right.(string); ok {
		return String(left) + String(right)
	}
	return numericValue(left) + numericValue(right)
}

func numericValue(value any) float64 {
	switch value := value.(type) {
	case bool:
		if value {
			return 1
		}
		return 0
	case float64:
		return value
	case undefined:
		return math.NaN()
	default:
		panic(fmt.Sprintf("unsupported JavaScript number conversion for %T", value))
	}
}

func Mod(left, right float64) float64 {
	return math.Mod(left, right)
}

func Number(value float64) float64 {
	return value
}

func String(value any) string {
	switch value := value.(type) {
	case string:
		return value
	case bool:
		return strconv.FormatBool(value)
	case float64:
		return numberString(value)
	case []string:
		return strings.Join(value, ",")
	case undefined:
		return "undefined"
	default:
		panic(fmt.Sprintf("unsupported JavaScript string conversion for %T", value))
	}
}

func inspectStringArray(values []string) string {
	if len(values) == 0 {
		return "[]"
	}
	limit := min(len(values), 100)
	quoted := make([]string, limit)
	for index, value := range values[:limit] {
		quoted[index] = quoteInspectString(value)
	}
	remaining := len(values) - limit
	if len(quoted) > 6 {
		if grouped := groupInspectStrings(quoted); len(grouped) != len(quoted) {
			if remaining > 0 {
				grouped = append(grouped, remainingInspectItems(remaining))
			}
			return "[\n  " + strings.Join(grouped, ",\n  ") + "\n]"
		}
	}
	if remaining > 0 {
		quoted = append(quoted, remainingInspectItems(remaining))
	}
	if inspectStringsFitLine(quoted) {
		return "[ " + strings.Join(quoted, ", ") + " ]"
	}
	return "[\n  " + strings.Join(quoted, ",\n  ") + "\n]"
}

func remainingInspectItems(count int) string {
	plural := "s"
	if count == 1 {
		plural = ""
	}
	return fmt.Sprintf("... %d more item%s", count, plural)
}

func quoteInspectString(value string) string {
	if len(utf16.Encode([]rune(value))) > 74 && strings.Contains(value, "\n") {
		lines := strings.SplitAfter(value, "\n")
		if lines[len(lines)-1] == "" {
			lines = lines[:len(lines)-1]
		}
		if len(lines) > 1 {
			for index, line := range lines {
				lines[index] = quoteInspectStringPart(line)
			}
			return strings.Join(lines, " +\n    ")
		}
	}
	return quoteInspectStringPart(value)
}

func quoteInspectStringPart(value string) string {
	quote := byte('\'')
	if strings.Contains(value, "'") {
		switch {
		case !strings.Contains(value, "\""):
			quote = '"'
		case !strings.Contains(value, "`") && !strings.Contains(value, "${"):
			quote = '`'
		}
	}

	var escaped strings.Builder
	escaped.WriteByte(quote)
	for _, character := range value {
		switch character {
		case '\\':
			escaped.WriteString("\\\\")
		case '\b':
			escaped.WriteString("\\b")
		case '\t':
			escaped.WriteString("\\t")
		case '\n':
			escaped.WriteString("\\n")
		case '\v':
			escaped.WriteString("\\x0B")
		case '\f':
			escaped.WriteString("\\f")
		case '\r':
			escaped.WriteString("\\r")
		case rune(quote):
			escaped.WriteByte('\\')
			escaped.WriteRune(character)
		default:
			if character < 0x20 || character >= 0x7f && character <= 0x9f {
				fmt.Fprintf(&escaped, "\\x%02X", character)
			} else {
				escaped.WriteRune(character)
			}
		}
	}
	escaped.WriteByte(quote)
	return escaped.String()
}

func inspectStringsFitLine(values []string) bool {
	count := len(values)
	length := 2*count + 11
	if length+count > 80 {
		return false
	}
	for _, value := range values {
		length += len(utf16.Encode([]rune(value)))
		if length > 80 {
			return false
		}
	}
	return true
}

func groupInspectStrings(values []string) []string {
	lengths := make([]int, len(values))
	totalLength := 0
	maxLength := 0
	for index, value := range values {
		length := inspectStringWidth(value)
		lengths[index] = length
		totalLength += length + 2
		maxLength = max(maxLength, length)
	}
	actualMax := maxLength + 2
	if actualMax*3 >= 80 || !(float64(totalLength)/float64(actualMax) > 5 || maxLength <= 6) {
		return values
	}

	averageBias := math.Sqrt(float64(actualMax) - float64(totalLength)/float64(len(values)))
	biasedMax := math.Max(float64(actualMax)-3-averageBias, 1)
	columns := min(
		int(math.Round(math.Sqrt(2.5*biasedMax*float64(len(values)))/biasedMax)),
		80/actualMax,
		12,
	)
	if columns <= 1 {
		return values
	}

	columnWidths := make([]int, columns)
	for column := range columns {
		for index := column; index < len(values); index += columns {
			columnWidths[column] = max(columnWidths[column], lengths[index]+2)
		}
	}

	lines := make([]string, 0, (len(values)+columns-1)/columns)
	for start := 0; start < len(values); start += columns {
		end := min(start+columns, len(values))
		var line strings.Builder
		for index := start; index < end; index++ {
			line.WriteString(values[index])
			if index < end-1 {
				line.WriteString(", ")
				line.WriteString(strings.Repeat(" ", columnWidths[index-start]-lengths[index]-2))
			}
		}
		lines = append(lines, line.String())
	}
	return lines
}

func inspectStringWidth(value string) int {
	width := 0
	for _, character := range value {
		switch {
		case unicode.Is(unicode.Mn, character), unicode.Is(unicode.Me, character), character == '\u200d':
		case character >= 0x1100 && (character <= 0x115f ||
			character == 0x2329 || character == 0x232a ||
			character >= 0x2e80 && character <= 0xa4cf && character != 0x303f ||
			character >= 0xac00 && character <= 0xd7a3 ||
			character >= 0xf900 && character <= 0xfaff ||
			character >= 0xfe10 && character <= 0xfe19 ||
			character >= 0xfe30 && character <= 0xfe6f ||
			character >= 0xff00 && character <= 0xff60 ||
			character >= 0xffe0 && character <= 0xffe6 ||
			character >= 0x1f1e6 && character <= 0x1f1ff ||
			character >= 0x1f300 && character <= 0x1faff ||
			character >= 0x20000 && character <= 0x3fffd):
			width += 2
		default:
			width++
		}
	}
	return width
}

func numberString(value float64) string {
	if math.IsNaN(value) {
		return "NaN"
	}
	if math.IsInf(value, 1) {
		return "Infinity"
	}
	if math.IsInf(value, -1) {
		return "-Infinity"
	}
	if value == 0 {
		return "0"
	}

	if math.Signbit(value) {
		return "-" + numberString(math.Abs(value))
	}

	formatted := strconv.FormatFloat(value, 'e', -1, 64)
	exponentIndex := strings.IndexByte(formatted, 'e')
	exponent, _ := strconv.Atoi(formatted[exponentIndex+1:])
	digits := strings.Replace(formatted[:exponentIndex], ".", "", 1)
	decimalPoint := exponent + 1

	switch {
	case decimalPoint <= 0 && decimalPoint > -6:
		return "0." + strings.Repeat("0", -decimalPoint) + digits
	case decimalPoint > 0 && decimalPoint <= 21:
		if decimalPoint >= len(digits) {
			return digits + strings.Repeat("0", decimalPoint-len(digits))
		}
		return digits[:decimalPoint] + "." + digits[decimalPoint:]
	default:
		fraction := ""
		if len(digits) > 1 {
			fraction = "." + digits[1:]
		}
		return digits[:1] + fraction + fmt.Sprintf("e%+d", decimalPoint-1)
	}
}
