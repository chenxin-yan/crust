// Package runtime provides JavaScript semantics used by emitted Go programs.
package runtime

import (
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"unicode/utf16"
)

// Argv returns a Node-shaped argv while preserving user arguments from os.Args.
func Argv() []string {
	return append([]string{os.Args[0], os.Args[0]}, os.Args[1:]...)
}

func Index(values []string, index float64) string {
	if index < 0 || index >= float64(len(values)) || index != math.Trunc(index) {
		return "undefined"
	}
	return values[int(index)]
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
	if code != math.Trunc(code) {
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
	default:
		panic(fmt.Sprintf("unsupported JavaScript length for %T", value))
	}
}

func Log(values ...any) {
	for index, value := range values {
		if index > 0 {
			fmt.Print(" ")
		}
		if number, ok := value.(float64); ok {
			if number == 0 && math.Signbit(number) {
				fmt.Print("-0")
			} else {
				fmt.Print(numberString(number))
			}
		} else {
			fmt.Print(value)
		}
	}
	fmt.Println()
}

func Mod(left, right float64) float64 {
	return math.Mod(left, right)
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
	default:
		panic(fmt.Sprintf("unsupported JavaScript string conversion for %T", value))
	}
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
