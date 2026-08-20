// Package runtime provides JavaScript semantics used by emitted Go programs.
package runtime

import (
	"fmt"
	"math"
	"os"
	"strconv"
)

// Argv returns a Node-shaped argv while preserving user arguments from os.Args.
func Argv() []string {
	return append([]string{os.Args[0], os.Args[0]}, os.Args[1:]...)
}

func Exit(code float64) {
	os.Exit(int(code))
}

func Log(values ...any) {
	fmt.Println(values...)
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
		return strconv.FormatFloat(value, 'g', -1, 64)
	default:
		panic(fmt.Sprintf("unsupported JavaScript string conversion for %T", value))
	}
}
